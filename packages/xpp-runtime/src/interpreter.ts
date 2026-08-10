/**
 * The tree-walking interpreter.
 *
 * Not a compiler: it walks the AST, keeps a scope chain, and drives the virtual
 * database. Three rules shape everything here.
 *
 * 1. It never throws a raw JS error across the package boundary. Failures come back as
 *    `XppError`s in `RunResult.errors`.
 * 2. Runtime errors mirror real ones. The forUpdate check (VB-003) and the ttsLevel
 *    check (VB-004) are enforced, because meeting them is the lesson.
 * 3. Exception semantics follow VB-007 to VB-011, including the rule that a `catch`
 *    inside a transaction cannot catch what was thrown in that transaction. That one is
 *    invisible until it bites, and it is why lesson 8 exists.
 */

import {
  EXECUTION_LIMITS,
  XppErrorCodes,
  type CompanyId,
  type InfologEntry,
  type SourceSpan,
  type SqlTraceEntry,
  type SqlValue,
  type XppError,
} from "@xpplab/xpp-core";
import type {
  Expression,
  SelectClauses,
  SourceUnit,
  Statement,
  TypeReference,
} from "@xpplab/xpp-parser";
import {
  DATAAREAID_FIELD,
  RECID_FIELD,
  getBaseEnum,
  getTableSchema,
  isCompiled,
  selectToSql,
  type Row,
  type TableName,
  type VirtualDb,
} from "@xpplab/virtual-db";
import { callBuiltin, formatString, isBuiltin } from "./builtins";
import {
  BudgetExceeded,
  RuntimeError,
  ThrownException,
  catchMatches,
  isCatchableInsideTransaction,
  type XppExceptionName,
} from "./errors";
import { createInfolog, type Infolog } from "./infolog";
import { Scope, closestName } from "./scope";
import {
  NULL,
  VOID,
  arithmeticResult,
  bool,
  defaultValueFor,
  fromSqlValue,
  int,
  real,
  str,
  toBoolean,
  toDisplayString,
  toNumber,
  toSqlValue,
  valuesEqual,
  type TableBuffer,
  type XppValue,
} from "./values";

export interface RunOptions {
  ast: SourceUnit;
  db: VirtualDb;
  company?: CompanyId;
  timeoutMs?: number;
  maxStatements?: number;
  /** Fixed date for `today()`, so golden files stay stable. Defaults to 2026-08-10. */
  today?: string;
  onStatement?: (line: number) => boolean | void;
}

export interface RunResult {
  ok: boolean;
  infolog: InfologEntry[];
  sqlTrace: SqlTraceEntry[];
  errors: XppError[];
  statementsExecuted: number;
  durationMs: number;
  /** Non-zero means the run ended mid-transaction, which F&O treats as a defect. */
  uncommittedTransactionDepth: number;
}

/** Non-local control flow. None of these escape `run`. */
class BreakSignal {}
class ContinueSignal {}
class RetrySignal {}
class ReturnSignal {
  constructor(readonly value: XppValue) {}
}

export async function run(options: RunOptions): Promise<RunResult> {
  const interpreter = new Interpreter(options);
  return interpreter.execute();
}

export class Interpreter {
  readonly infolog: Infolog = createInfolog();
  readonly #options: RunOptions;
  readonly #db: VirtualDb;
  readonly #globals = new Scope();
  readonly #errors: XppError[] = [];
  readonly #today: string;
  readonly #deadline: number;
  readonly #maxStatements: number;

  #scope: Scope;
  #statements = 0;
  #currentLine = 0;
  #transactionDepth = 0;

  /**
   * Open transaction scopes, outermost first.
   *
   * Identities, not depths. Two sibling `ttsbegin` blocks are both at depth 1, so the
   * ttsLevel check (VB-004) cannot distinguish them by depth alone.
   */
  #openScopes: number[] = [];
  #nextScopeId = 1;

  constructor(options: RunOptions) {
    this.#options = options;
    this.#db = options.db;
    this.#scope = this.#globals;
    this.#today = options.today ?? "2026-08-10";
    this.#maxStatements = options.maxStatements ?? EXECUTION_LIMITS.maxStatements;
    this.#deadline = Date.now() + (options.timeoutMs ?? EXECUTION_LIMITS.timeoutMs);
  }

  get statementsExecuted(): number {
    return this.#statements;
  }

  get scope(): Scope {
    return this.#scope;
  }

  async execute(): Promise<RunResult> {
    const startedAt = Date.now();
    this.#db.clearTrace();

    try {
      for (const statement of this.#options.ast.statements) {
        await this.#statement(statement);
      }
    } catch (error) {
      await this.#handleTopLevel(error);
    }

    // VB-007's cousin: work left uncommitted at the end of a run is a defect in F&O,
    // and silently committing it would teach the opposite.
    const depth = this.#transactionDepth;
    if (depth > 0) {
      this.#errors.push({
        code: XppErrorCodes.UncommittedDataAtEndOfRun,
        message: `The code finished with ${depth} open transaction${depth === 1 ? "" : "s"}.`,
        line: this.#currentLine,
        column: 1,
        hint: "Every `ttsbegin` needs a matching `ttscommit` or `ttsabort`. The changes have been rolled back.",
      });
      await this.#db.abortTransaction().catch(() => undefined);
      this.#transactionDepth = 0;
    }

    return {
      ok: this.#errors.length === 0,
      infolog: [...this.infolog.entries()],
      sqlTrace: this.#db.getTrace(),
      errors: this.#errors,
      statementsExecuted: this.#statements,
      durationMs: Date.now() - startedAt,
      uncommittedTransactionDepth: depth,
    };
  }

  async #handleTopLevel(error: unknown): Promise<void> {
    if (error instanceof ThrownException) {
      // An uncaught throw ends the run. The message was already written to the Infolog
      // by error()/warning(), so do not write it twice (VB-010).
      await this.#abortOpenTransaction();
      this.#errors.push({
        code: XppErrorCodes.UnhandledException,
        message:
          error.message.length > 0
            ? `Unhandled exception: ${error.message}`
            : `Unhandled Exception::${error.xppException}.`,
        line: error.span?.start.line ?? this.#currentLine,
        column: error.span?.start.column ?? 1,
        hint: "Wrap the code in `try { … } catch (Exception::Error) { … }` to handle this yourself.",
      });
      return;
    }

    if (error instanceof RuntimeError) {
      await this.#abortOpenTransaction();
      this.#errors.push(error.toXppError());
      return;
    }

    if (error instanceof BudgetExceeded) {
      await this.#abortOpenTransaction();
      this.#errors.push({
        code: error.code,
        message: error.message,
        line: this.#currentLine,
        column: 1,
        hint: error.hint,
      });
      return;
    }

    if (error instanceof BreakSignal || error instanceof ContinueSignal) {
      this.#errors.push({
        code: XppErrorCodes.ExpectedStatement,
        message: "`break` and `continue` are only valid inside a loop.",
        line: this.#currentLine,
        column: 1,
        hint: "Move it inside the `while`, `for` or `do` block it belongs to.",
      });
      return;
    }

    if (error instanceof RetrySignal) {
      this.#errors.push({
        code: XppErrorCodes.ExpectedStatement,
        message: "`retry` is only valid inside a `catch` block.",
        line: this.#currentLine,
        column: 1,
        hint: "`retry` jumps back to the start of the `try` it belongs to, so it has to live in that `try`'s `catch`.",
      });
      return;
    }

    if (error instanceof ReturnSignal) return;

    // Anything reaching here is our bug, not the learner's. Surface it as such rather
    // than dressing it up as an X++ error.
    throw error;
  }

  async #abortOpenTransaction(): Promise<void> {
    // VB-007: an exception inside a transaction aborts it.
    if (this.#transactionDepth === 0) return;
    await this.#db.abortTransaction().catch(() => undefined);
    this.#transactionDepth = 0;
  }

  // -- budget --------------------------------------------------------------

  #tick(line: number): void {
    this.#statements += 1;
    this.#currentLine = line;

    if (this.#statements > this.#maxStatements) {
      throw new BudgetExceeded(
        XppErrorCodes.StatementBudgetExceeded,
        `This code ran more than ${this.#maxStatements.toLocaleString("en-GB")} statements and was stopped.`,
        "That is almost always an endless loop. Check that the loop condition can become false.",
      );
    }

    // Checked every 500 statements: Date.now() on every statement is measurable.
    if (this.#statements % 500 === 0 && Date.now() > this.#deadline) {
      throw new BudgetExceeded(
        XppErrorCodes.ExecutionTimeout,
        "This code took too long and was stopped.",
        "Look for a loop that never ends, or a `while select` with no `where` over a large table.",
      );
    }

    if (this.#options.onStatement?.(line) === false) {
      throw new BudgetExceeded(XppErrorCodes.ExecutionTimeout, "Execution was stopped.", "");
    }
  }

  // -- statements ----------------------------------------------------------

  async #statement(statement: Statement): Promise<void> {
    this.#tick(statement.span.start.line);

    switch (statement.kind) {
      case "block": {
        const outer = this.#scope;
        this.#scope = outer.child();
        try {
          for (const inner of statement.statements) await this.#statement(inner);
        } finally {
          this.#scope = outer;
        }
        return;
      }

      case "variableDeclaration": {
        for (const declarator of statement.declarators) {
          const value =
            declarator.initializer === undefined
              ? this.#initialValue(statement.type)
              : await this.#evaluate(declarator.initializer);
          this.#scope.declare(declarator.name, value, statement.type.name);
        }
        return;
      }

      case "expressionStatement":
        await this.#evaluate(statement.expression);
        return;

      case "if": {
        if (toBoolean(await this.#evaluate(statement.test))) {
          await this.#statement(statement.consequent);
        } else if (statement.alternate !== undefined) {
          await this.#statement(statement.alternate);
        }
        return;
      }

      case "while": {
        while (toBoolean(await this.#evaluate(statement.test))) {
          this.#tick(statement.span.start.line);
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
        }
        return;
      }

      case "doWhile": {
        do {
          this.#tick(statement.span.start.line);
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
        } while (toBoolean(await this.#evaluate(statement.test)));
        return;
      }

      case "for": {
        if (statement.init !== undefined) await this.#evaluate(statement.init);
        for (;;) {
          if (statement.test !== undefined && !toBoolean(await this.#evaluate(statement.test))) {
            break;
          }
          this.#tick(statement.span.start.line);
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
          if (statement.update !== undefined) await this.#evaluate(statement.update);
        }
        return;
      }

      case "switch":
        await this.#switch(statement);
        return;

      case "break":
        throw new BreakSignal();

      case "continue":
        throw new ContinueSignal();

      case "retry":
        throw new RetrySignal();

      case "return":
        throw new ReturnSignal(
          statement.argument === undefined ? VOID : await this.#evaluate(statement.argument),
        );

      case "throw":
        await this.#throw(statement.argument, statement.span);
        return;

      case "tryCatch":
        await this.#tryCatch(statement);
        return;

      case "ttsBegin":
        this.#transactionDepth = (await this.#db.beginTransaction()).depth;
        this.#openScopes.push(this.#nextScopeId++);
        return;

      case "ttsCommit": {
        if (this.#transactionDepth === 0) {
          throw new RuntimeError(
            XppErrorCodes.TransactionNotStarted,
            "ttscommit without a matching ttsbegin.",
            "Every `ttscommit` closes a `ttsbegin`. Check that they are balanced.",
            "Error",
            statement.span,
          );
        }
        this.#transactionDepth = (await this.#db.commitTransaction()).depth;
        this.#openScopes.pop();
        return;
      }

      case "ttsAbort": {
        if (this.#transactionDepth === 0) {
          throw new RuntimeError(
            XppErrorCodes.TransactionNotStarted,
            "ttsabort without a matching ttsbegin.",
            "`ttsabort` discards an open transaction, so there has to be one open.",
            "Error",
            statement.span,
          );
        }
        // VB-001: aborts everything, from any depth.
        this.#transactionDepth = (await this.#db.abortTransaction()).depth;
        this.#openScopes = [];
        return;
      }

      case "changeCompany":
        await this.#changeCompany(statement);
        return;

      case "select":
        await this.#executeSelect(statement.clauses, statement.span);
        return;

      case "whileSelect":
        await this.#executeWhileSelect(statement);
        return;

      case "updateRecordset":
        await this.#updateRecordset(statement);
        return;

      case "deleteFrom":
        await this.#deleteFrom(statement);
        return;

      case "insertRecordset":
        await this.#insertRecordset(statement);
        return;

      case "nextCall":
        // Chain of Command resolution lands in Phase 8. Refusing loudly is better than
        // pretending the call did something.
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          "Chain of Command is not available yet.",
          "`next` needs the extension model, which arrives with the customisation track. For now, write the logic directly.",
          "Error",
          statement.span,
        );

      case "emptyStatement":
        return;
    }
  }

  #initialValue(type: TypeReference): XppValue {
    const table = getTableSchema(type.name);
    if (table !== undefined) {
      const buffer: TableBuffer = {
        tableName: table.name,
        selectedForUpdate: false,
        isEmpty: true,
      };
      return { type: "buffer", buffer };
    }
    return defaultValueFor(type.name);
  }

  async #switch(statement: Extract<Statement, { kind: "switch" }>): Promise<void> {
    const discriminant = await this.#evaluate(statement.discriminant);
    let matched = false;

    try {
      for (const branch of statement.cases) {
        if (!matched) {
          if (branch.tests === undefined) {
            matched = true;
          } else {
            for (const test of branch.tests) {
              if (valuesEqual(discriminant, await this.#evaluate(test))) {
                matched = true;
                break;
              }
            }
          }
        }
        // Once matched, execution falls through until a break, as in C.
        if (matched) {
          for (const inner of branch.statements) await this.#statement(inner);
        }
      }
    } catch (error) {
      if (!(error instanceof BreakSignal)) throw error;
    }
  }

  async #throw(argument: Expression, span: SourceSpan): Promise<void> {
    const value = await this.#evaluate(argument);

    // VB-010: `error("…")` has already written to the Infolog and hands back
    // Exception::Error. `throw Exception::Error` writes nothing.
    if (value.type === "enum" && value.enumName.toLowerCase() === "exception") {
      throw new ThrownException(value.valueName as XppExceptionName, "", span);
    }

    throw new ThrownException("Error", toDisplayString(value), span);
  }

  /**
   * try / catch / retry.
   *
   * The rule worth reading: VB-008. An exception thrown inside a transaction cannot be
   * caught by a `catch` that is also inside that transaction. The transaction aborts
   * (VB-007) and the exception propagates outward to the first `catch` beyond it.
   */
  async #tryCatch(statement: Extract<Statement, { kind: "tryCatch" }>): Promise<void> {
    for (;;) {
      const mark = this.infolog.mark();
      const depthOnEntry = this.#transactionDepth;

      try {
        await this.#statement(statement.block);
        return;
      } catch (error) {
        if (!(error instanceof ThrownException) && !(error instanceof RuntimeError)) throw error;

        const thrown = error.xppException;
        const depthAtThrow = this.#transactionDepth;

        // VB-007: the transaction is cancelled either way.
        if (depthAtThrow > 0) {
          this.#transactionDepth = (await this.#db.abortTransaction()).depth;
        }

        /**
         * VB-008: a `catch` that is itself inside the transaction block does not get a
         * look in — the innermost `catch` *outside* it is tested first.
         *
         * "Inside" means this `try` was entered without opening the transaction that
         * was live when the throw happened. If the try was entered at a shallower depth
         * than the throw, the transaction started within the try, so the catch is
         * outside the transaction block and is eligible.
         */
        const catchIsInsideTransaction = depthAtThrow > 0 && depthOnEntry >= depthAtThrow;
        if (catchIsInsideTransaction && !isCatchableInsideTransaction(thrown)) {
          throw error;
        }

        const handler = statement.handlers.find((candidate) =>
          catchMatches(this.#catchName(candidate.exception), thrown),
        );
        if (handler === undefined) throw error;

        try {
          await this.#statement(handler.body);
          return;
        } catch (handlerError) {
          if (!(handlerError instanceof RetrySignal)) throw handlerError;
          // VB-009: retry erases everything logged since entering the try block.
          this.infolog.rewindTo(mark);
        }
      }
    }
  }

  /** `catch (Exception::Deadlock)` → `"Deadlock"`. An unqualified catch has none. */
  #catchName(exception: Expression | undefined): string | undefined {
    if (exception === undefined) return undefined;
    if (exception.kind === "enumAccess") return exception.valueName;
    if (exception.kind === "identifier") return exception.name;
    return undefined;
  }

  async #changeCompany(statement: Extract<Statement, { kind: "changeCompany" }>): Promise<void> {
    const target = toDisplayString(await this.#evaluate(statement.company));
    const previous = this.#db.getCompany();

    try {
      await this.#db.setCompany(target);
    } catch {
      throw new RuntimeError(
        XppErrorCodes.CompanyNotFound,
        `There is no company with the id '${target}'.`,
        `Available companies: ${(await this.#db.listCompanies()).join(", ")}.`,
        "Error",
        statement.span,
      );
    }

    try {
      await this.#statement(statement.body);
    } finally {
      // Restored even if the body threw, exactly as the real block scope does.
      await this.#db.setCompany(previous);
    }
  }

  // -- select --------------------------------------------------------------

  #compile(clauses: SelectClauses, span: SourceSpan) {
    const compiled = selectToSql(clauses, {
      company: this.#db.getCompany(),
      resolveBuffer: (name) => this.#bufferTable(name),
    });

    if (!isCompiled(compiled)) {
      const first = compiled.errors[0]!;
      throw new RuntimeError(
        first.code,
        first.message,
        first.hint,
        "Error",
        first.line === 0 ? span : undefined,
      );
    }
    return compiled;
  }

  #bufferTable(name: string): TableName | undefined {
    const value = this.#scope.get(name);
    if (value?.type !== "buffer") return undefined;
    return value.buffer.tableName as TableName;
  }

  #bufferOf(name: string, span: SourceSpan): TableBuffer {
    const value = this.#scope.get(name);
    if (value?.type !== "buffer") {
      throw new RuntimeError(
        XppErrorCodes.UndeclaredIdentifier,
        `'${name}' is not a table buffer.`,
        `Declare it first — for example \`CustTable ${name};\`.`,
        "Error",
        span,
      );
    }
    return value.buffer;
  }

  /**
   * Spreads one SQL row across the buffers the select populated.
   *
   * `outputs` is buffer → columns in statement order, so the row is consumed left to
   * right in the same order the SELECT list was built.
   */
  #distribute(
    row: SqlValue[],
    outputs: Record<string, string[]>,
    forUpdate: boolean,
    span: SourceSpan,
  ): void {
    let cursor = 0;
    for (const [bufferName, columns] of Object.entries(outputs)) {
      const buffer = this.#bufferOf(bufferName, span);
      const values: Row = {};
      for (const column of columns) values[column] = row[cursor++] ?? null;

      buffer.row = values;
      buffer.isEmpty = false;
      buffer.selectedForUpdate = forUpdate;
      buffer.company = String(values[DATAAREAID_FIELD] ?? this.#db.getCompany());
      if (forUpdate) buffer.selectedInScope = this.#openScopes.at(-1);
    }
  }

  #markEmpty(outputs: Record<string, string[]>, span: SourceSpan): void {
    for (const bufferName of Object.keys(outputs)) {
      const buffer = this.#bufferOf(bufferName, span);
      buffer.row = undefined;
      buffer.isEmpty = true;
      buffer.selectedForUpdate = false;
    }
  }

  async #executeSelect(clauses: SelectClauses, span: SourceSpan): Promise<void> {
    const compiled = this.#compile(clauses, span);
    // A bare `select` reads one record, the way X++ does without `while`.
    const sql = compiled.sql.includes(" LIMIT ") ? compiled.sql : `${compiled.sql} LIMIT 1`;
    const result = await this.#exec(sql, compiled.parameters, span, "select");

    if (result.rows.length === 0) {
      this.#markEmpty(compiled.outputs, span);
      return;
    }
    this.#distribute(result.rows[0]!, compiled.outputs, compiled.forUpdate, span);
  }

  async #executeWhileSelect(statement: Extract<Statement, { kind: "whileSelect" }>): Promise<void> {
    const { clauses, span } = statement;
    const compiled = this.#compile(clauses, span);
    const result = await this.#exec(compiled.sql, compiled.parameters, span, "while select");

    // The whole result set is fetched once, which is what makes the SQL trace show one
    // statement for the loop rather than one per row. That contrast is lesson 6.
    for (const row of result.rows) {
      this.#tick(span.start.line);
      this.#distribute(row, compiled.outputs, compiled.forUpdate, span);
      try {
        await this.#statement(statement.body);
      } catch (error) {
        if (error instanceof BreakSignal) break;
        if (!(error instanceof ContinueSignal)) throw error;
      }
    }

    if (result.rows.length === 0) this.#markEmpty(compiled.outputs, span);
  }

  // -- set-based DML -------------------------------------------------------

  async #updateRecordset(
    statement: Extract<Statement, { kind: "updateRecordset" }>,
  ): Promise<void> {
    const { clauses, assignments, span } = statement;
    this.#requireTransaction("update_recordset", span);

    const table = this.#bufferTable(clauses.source.buffer);
    if (table === undefined) {
      throw new RuntimeError(
        XppErrorCodes.UndeclaredIdentifier,
        `'${clauses.source.buffer}' has not been declared as a table buffer.`,
        `Declare it first — for example \`InventTable ${clauses.source.buffer};\`.`,
        "Error",
        span,
      );
    }

    const parameters: SqlValue[] = [];
    const sets: string[] = [];
    for (const assignment of assignments) {
      sets.push(`${this.#column(table, assignment.field, span)} = ?`);
      parameters.push(toSqlValue(await this.#evaluate(assignment.value)));
    }

    const compiled = this.#compile(clauses, span);
    const where = extractWhere(compiled.sql, compiled.aliases[clauses.source.buffer] ?? "t0");
    parameters.push(...compiled.parameters);

    const sql = `UPDATE ${table} SET ${sets.join(", ")}${where === undefined ? "" : ` WHERE ${where}`}`;
    await this.#exec(sql, parameters, span, "update_recordset");
  }

  async #deleteFrom(statement: Extract<Statement, { kind: "deleteFrom" }>): Promise<void> {
    const { clauses, span } = statement;
    this.#requireTransaction("delete_from", span);

    const table = this.#bufferTable(clauses.source.buffer);
    if (table === undefined) {
      throw new RuntimeError(
        XppErrorCodes.UndeclaredIdentifier,
        `'${clauses.source.buffer}' has not been declared as a table buffer.`,
        `Declare it first — for example \`InventTable ${clauses.source.buffer};\`.`,
        "Error",
        span,
      );
    }

    const compiled = this.#compile(clauses, span);
    const where = extractWhere(compiled.sql, compiled.aliases[clauses.source.buffer] ?? "t0");
    const sql = `DELETE FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`;
    await this.#exec(sql, compiled.parameters, span, "delete_from");
  }

  async #insertRecordset(
    statement: Extract<Statement, { kind: "insertRecordset" }>,
  ): Promise<void> {
    const { targetBuffer, targetFields, source, span } = statement;
    this.#requireTransaction("insert_recordset", span);

    const table = this.#bufferTable(targetBuffer);
    if (table === undefined) {
      throw new RuntimeError(
        XppErrorCodes.UndeclaredIdentifier,
        `'${targetBuffer}' has not been declared as a table buffer.`,
        `Declare it first — for example \`InventTable ${targetBuffer};\`.`,
        "Error",
        span,
      );
    }

    const compiled = this.#compile(source, span);
    const columns = targetFields.map((field) => this.#column(table, field, span));

    // The company is stamped on, not selected: an insert_recordset always writes into
    // the current company, whatever the source rows came from. It goes in as a bound
    // parameter like everything else — the trace never shows an inlined value.
    const [selectList, rest] = splitSelect(compiled.sql, span);
    const sql = `INSERT INTO ${table} (${columns.join(", ")}, ${DATAAREAID_FIELD}) SELECT ${selectList}, ? ${rest}`;

    await this.#exec(
      sql,
      [this.#db.getCompany(), ...compiled.parameters],
      span,
      `${table}.insert_recordset`,
    );
  }

  /**
   * Runs a statement and translates any database failure into an X++ error.
   *
   * SQLite constraint violations must not reach the UI as themselves — a learner who
   * inserts a duplicate key should meet `DuplicateKeyException`, which is the real X++
   * exception, not "UNIQUE constraint failed: InventTable.DATAAREAID, InventTable.ItemId".
   */
  async #exec(sql: string, parameters: SqlValue[], span: SourceSpan, context: string) {
    try {
      return await this.#db.exec(sql, parameters, span.start.line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/UNIQUE constraint failed/i.test(message)) {
        const index = /UNIQUE constraint failed: (.+)/i.exec(message)?.[1] ?? "";
        const fields = index
          .split(",")
          .map((part) => part.trim().split(".").at(-1))
          .filter((field) => field !== DATAAREAID_FIELD)
          .join(", ");
        throw new RuntimeError(
          XppErrorCodes.DuplicateKey,
          `Cannot create a record. The record already exists.`,
          `A record with the same ${fields || "key"} is already there in this company. Check before inserting, or update the existing record instead.`,
          "DuplicateKeyException",
          span,
        );
      }

      throw new RuntimeError(
        XppErrorCodes.TableNotFound,
        `The database rejected this statement (${context}).`,
        message,
        "Error",
        span,
      );
    }
  }

  #column(table: TableName, field: string, span: SourceSpan): string {
    const schema = getTableSchema(table)!;
    const known = [...schema.fields.map((f) => f.name), RECID_FIELD, DATAAREAID_FIELD];
    const match = known.find((name) => name.toLowerCase() === field.toLowerCase());
    if (match === undefined) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `${table} has no field named '${field}'.`,
        `Fields on ${table}: ${known.join(", ")}.`,
        "Error",
        span,
      );
    }
    return match;
  }

  #requireTransaction(what: string, span: SourceSpan): void {
    if (this.#transactionDepth > 0) return;
    throw new RuntimeError(
      XppErrorCodes.UpdateOutsideTransaction,
      `${what} is not allowed outside a transaction scope.`,
      "Wrap it in `ttsbegin;` and `ttscommit;`. F&O will not let you write to the database outside a transaction.",
      "Error",
      span,
    );
  }

  // -- expressions ---------------------------------------------------------

  async #evaluate(expression: Expression): Promise<XppValue> {
    switch (expression.kind) {
      case "literal":
        return this.#literal(expression);

      case "identifier": {
        const value = this.#scope.get(expression.name);
        if (value === undefined) {
          const suggestion = closestName(expression.name, this.#scope.visibleNames());
          throw new RuntimeError(
            XppErrorCodes.UndeclaredIdentifier,
            `'${expression.name}' has not been declared.`,
            suggestion === undefined
              ? "X++ has no implicit declaration — every variable needs a type and a name before it is used."
              : `Did you mean \`${suggestion}\`?`,
            "Error",
            expression.span,
          );
        }
        return value;
      }

      case "enumAccess":
        return this.#enumAccess(expression);

      case "container": {
        const elements: XppValue[] = [];
        for (const element of expression.elements) elements.push(await this.#evaluate(element));
        return { type: "container", elements };
      }

      case "binary":
        return this.#binary(expression);

      case "unary": {
        const argument = await this.#evaluate(expression.argument);
        switch (expression.operator) {
          case "-":
            return arithmeticResult(argument, argument, -toNumber(argument));
          case "+":
            return argument;
          case "~":
            return int(~toNumber(argument));
          default:
            return bool(!toBoolean(argument));
        }
      }

      case "conditional":
        return toBoolean(await this.#evaluate(expression.test))
          ? this.#evaluate(expression.consequent)
          : this.#evaluate(expression.alternate);

      case "assignment":
        return this.#assignment(expression);

      case "update":
        return this.#updateExpression(expression);

      case "memberAccess":
        return this.#memberAccess(expression);

      case "index": {
        const object = await this.#evaluate(expression.object);
        const index = toNumber(await this.#evaluate(expression.index));
        if (object.type === "container") return object.elements[index - 1] ?? NULL;
        return NULL;
      }

      case "call":
        return this.#call(expression);

      case "new":
        return this.#new(expression);
    }
  }

  #literal(expression: Extract<Expression, { kind: "literal" }>): XppValue {
    switch (expression.literalType) {
      case "int":
        return int(Number(expression.value));
      case "real":
        return real(Number(expression.value));
      case "boolean":
        return bool(Boolean(expression.value));
      case "date":
        return { type: "date", value: String(expression.value) };
      case "null":
        return NULL;
      default:
        return str(String(expression.value));
    }
  }

  #enumAccess(expression: Extract<Expression, { kind: "enumAccess" }>): XppValue {
    // `Exception::Error` is a language construct rather than an AOT enum, so it is
    // resolved without a lookup.
    if (expression.enumName.toLowerCase() === "exception") {
      return {
        type: "enum",
        enumName: "Exception",
        valueName: expression.valueName,
        value: 0,
      };
    }

    const baseEnum = getBaseEnum(expression.enumName);
    const value = baseEnum?.values.find(
      (candidate) => candidate.name.toLowerCase() === expression.valueName.toLowerCase(),
    );

    if (baseEnum === undefined || value === undefined) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `${expression.enumName}::${expression.valueName} is not a known enum value.`,
        baseEnum === undefined
          ? `There is no base enum called '${expression.enumName}'.`
          : `${expression.enumName} has: ${baseEnum.values.map((v) => v.name).join(", ")}.`,
        "Error",
        expression.span,
      );
    }

    return {
      type: "enum",
      enumName: baseEnum.name,
      valueName: value.name,
      value: value.value,
    };
  }

  async #binary(expression: Extract<Expression, { kind: "binary" }>): Promise<XppValue> {
    // Short-circuit before evaluating the right side, as X++ does.
    if (expression.operator === "&&") {
      const left = await this.#evaluate(expression.left);
      if (!toBoolean(left)) return bool(false);
      return bool(toBoolean(await this.#evaluate(expression.right)));
    }
    if (expression.operator === "||") {
      const left = await this.#evaluate(expression.left);
      if (toBoolean(left)) return bool(true);
      return bool(toBoolean(await this.#evaluate(expression.right)));
    }

    const left = await this.#evaluate(expression.left);
    const right = await this.#evaluate(expression.right);

    switch (expression.operator) {
      case "+":
        // `+` concatenates when either side is a string, which is how X++ builds text.
        if (left.type === "str" || right.type === "str") {
          return str(toDisplayString(left) + toDisplayString(right));
        }
        return arithmeticResult(left, right, toNumber(left) + toNumber(right));
      case "-":
        return arithmeticResult(left, right, toNumber(left) - toNumber(right));
      case "*":
        return arithmeticResult(left, right, toNumber(left) * toNumber(right));
      case "/": {
        const divisor = toNumber(right);
        if (divisor === 0) throw this.#divideByZero(expression.span);
        return real(toNumber(left) / divisor);
      }
      case "div": {
        const divisor = toNumber(right);
        if (divisor === 0) throw this.#divideByZero(expression.span);
        return int(Math.trunc(toNumber(left) / divisor));
      }
      case "mod": {
        const divisor = toNumber(right);
        if (divisor === 0) throw this.#divideByZero(expression.span);
        return int(toNumber(left) % divisor);
      }
      case "==":
        return bool(valuesEqual(left, right));
      case "!=":
        return bool(!valuesEqual(left, right));
      case "<":
        return bool(compare(left, right) < 0);
      case "<=":
        return bool(compare(left, right) <= 0);
      case ">":
        return bool(compare(left, right) > 0);
      case ">=":
        return bool(compare(left, right) >= 0);
      case "&":
        return int(toNumber(left) & toNumber(right));
      case "|":
        return int(toNumber(left) | toNumber(right));
      case "^":
        return int(toNumber(left) ^ toNumber(right));
      case "<<":
        return int(toNumber(left) << toNumber(right));
      case ">>":
        return int(toNumber(left) >> toNumber(right));
      case "like":
        return bool(likeMatches(toDisplayString(left), toDisplayString(right)));
      case "is":
      case "as":
        // Class inheritance arrives in Phase 8. Until then these have no meaning worth
        // faking, so they are refused rather than answered wrongly.
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          `The '${expression.operator}' operator needs class inheritance, which is not available yet.`,
          "Class hierarchies arrive with the customisation track.",
          "Error",
          expression.span,
        );
    }
  }

  #divideByZero(span: SourceSpan): RuntimeError {
    return new RuntimeError(
      XppErrorCodes.DivideByZero,
      "Division by zero.",
      "Check the divisor before dividing — an empty result set often leaves a counter at 0.",
      "Error",
      span,
    );
  }

  async #assignment(expression: Extract<Expression, { kind: "assignment" }>): Promise<XppValue> {
    const incoming = await this.#evaluate(expression.value);

    let value = incoming;
    if (expression.operator !== "=") {
      const current = await this.#evaluate(expression.target);
      const operator = expression.operator[0] as "+" | "-" | "*" | "/";
      value = await this.#binary({
        kind: "binary",
        operator,
        left: literalOf(current),
        right: literalOf(incoming),
        span: expression.span,
      });
    }

    await this.#assignTo(expression.target, value);
    return value;
  }

  async #assignTo(target: Expression, value: XppValue): Promise<void> {
    if (target.kind === "identifier") {
      if (!this.#scope.set(target.name, value)) {
        throw new RuntimeError(
          XppErrorCodes.UndeclaredIdentifier,
          `'${target.name}' has not been declared.`,
          "X++ has no implicit declaration — give it a type before assigning to it.",
          "Error",
          target.span,
        );
      }
      return;
    }

    if (target.kind === "memberAccess" && target.object.kind === "identifier") {
      const holder = this.#scope.get(target.object.name);
      if (holder?.type === "buffer") {
        const buffer = holder.buffer;
        const column = this.#column(buffer.tableName as TableName, target.member, target.span);
        buffer.row ??= {};
        buffer.row[column] = toSqlValue(value);
        buffer.isEmpty = false;
        return;
      }
    }

    throw new RuntimeError(
      XppErrorCodes.TypeMismatch,
      "This is not something that can be assigned to.",
      "Assign to a variable, or to a field of a table buffer.",
      "Error",
      target.span,
    );
  }

  async #updateExpression(expression: Extract<Expression, { kind: "update" }>): Promise<XppValue> {
    const current = await this.#evaluate(expression.argument);
    const delta = expression.operator === "++" ? 1 : -1;
    const updated = arithmeticResult(current, current, toNumber(current) + delta);
    await this.#assignTo(expression.argument, updated);
    return expression.prefix ? updated : current;
  }

  async #memberAccess(
    expression: Extract<Expression, { kind: "memberAccess" }>,
  ): Promise<XppValue> {
    const object = await this.#evaluate(expression.object);

    if (object.type === "buffer") {
      const buffer = object.buffer;
      const column = this.#column(
        buffer.tableName as TableName,
        expression.member,
        expression.span,
      );
      const schema = getTableSchema(buffer.tableName)!;
      const field = schema.fields.find((candidate) => candidate.name === column);

      const raw = buffer.row?.[column] ?? null;
      if (column === RECID_FIELD) return { type: "int64", value: Number(raw ?? 0) };
      return fromSqlValue(raw, field?.type ?? "str", field?.enumName);
    }

    throw new RuntimeError(
      XppErrorCodes.MethodNotFound,
      `'${expression.member}' is not available on this value.`,
      "Field access works on table buffers. Check that the variable is declared as a table.",
      "Error",
      expression.span,
    );
  }

  async #call(expression: Extract<Expression, { kind: "call" }>): Promise<XppValue> {
    const args: XppValue[] = [];
    for (const argument of expression.arguments) args.push(await this.#evaluate(argument));

    // A global function.
    if (expression.callee.kind === "identifier") {
      const name = expression.callee.name;
      if (isBuiltin(name)) {
        return callBuiltin(name, args, {
          infolog: this.infolog,
          line: expression.span.start.line,
          company: this.#db.getCompany(),
          today: this.#today,
        });
      }
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `There is no function called '${name}'.`,
        "The language subset lists every global function this simulator provides.",
        "Error",
        expression.span,
      );
    }

    // A method on a buffer.
    if (
      expression.callee.kind === "memberAccess" &&
      expression.callee.object.kind === "identifier"
    ) {
      const holder = this.#scope.get(expression.callee.object.name);
      if (holder?.type === "buffer") {
        return this.#bufferMethod(holder.buffer, expression.callee.member, expression.span);
      }
    }

    throw new RuntimeError(
      XppErrorCodes.MethodNotFound,
      "This method is not available.",
      "Buffer methods are `insert`, `update`, `delete`, `validateWrite`, `validateDelete` and `clear`.",
      "Error",
      expression.span,
    );
  }

  /**
   * `custTable.insert()`, `.update()`, `.delete()` and friends.
   *
   * This is where VB-003 and VB-004 are enforced, and where a learner meets the errors
   * that lessons 3 and 4 are about.
   */
  async #bufferMethod(buffer: TableBuffer, method: string, span: SourceSpan): Promise<XppValue> {
    const table = buffer.tableName as TableName;

    switch (method.toLowerCase()) {
      case "insert": {
        this.#requireTransaction(`${table}.insert()`, span);
        const row = { ...(buffer.row ?? {}) };
        delete row[RECID_FIELD];
        row[DATAAREAID_FIELD] = this.#db.getCompany();

        const columns = Object.keys(row);
        const placeholders = columns.map(() => "?").join(", ");
        await this.#exec(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          columns.map((column) => row[column] ?? null),
          span,
          `${table}.insert()`,
        );
        return VOID;
      }

      case "update": {
        this.#requireTransaction(`${table}.update()`, span);
        this.#requireSelectedForUpdate(buffer, "updated", span);

        const row = { ...(buffer.row ?? {}) };
        const recId = row[RECID_FIELD];
        delete row[RECID_FIELD];
        delete row[DATAAREAID_FIELD];

        const columns = Object.keys(row);
        const sets = columns.map((column) => `${column} = ?`).join(", ");
        await this.#exec(
          `UPDATE ${table} SET ${sets} WHERE ${RECID_FIELD} = ?`,
          [...columns.map((column) => row[column] ?? null), recId ?? 0],
          span,
          `${table}.update()`,
        );
        return VOID;
      }

      case "delete": {
        this.#requireTransaction(`${table}.delete()`, span);
        this.#requireSelectedForUpdate(buffer, "deleted", span);
        await this.#exec(
          `DELETE FROM ${table} WHERE ${RECID_FIELD} = ?`,
          [buffer.row?.[RECID_FIELD] ?? 0],
          span,
          `${table}.delete()`,
        );
        buffer.isEmpty = true;
        return VOID;
      }

      case "clear":
        buffer.row = undefined;
        buffer.isEmpty = true;
        buffer.selectedForUpdate = false;
        return VOID;

      case "recid":
        return { type: "int64", value: Number(buffer.row?.[RECID_FIELD] ?? 0) };

      case "validatewrite":
      case "validatedelete":
        // Field-level validation is Phase 7's, once the metadata layer knows what
        // "mandatory" means. Returning true here would be a lie, so it is refused.
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          `${method}() is not available yet.`,
          "Field validation needs the metadata layer, which arrives with the forms track.",
          "Error",
          span,
        );

      default:
        throw new RuntimeError(
          XppErrorCodes.MethodNotFound,
          `${table} has no method called '${method}'.`,
          "Buffer methods are `insert`, `update`, `delete` and `clear`. Fields are read as `buffer.FieldName`.",
          "Error",
          span,
        );
    }
  }

  /** VB-003 and VB-004, the two checks that make transactional integrity real. */
  #requireSelectedForUpdate(buffer: TableBuffer, verb: string, span: SourceSpan): void {
    if (buffer.isEmpty) {
      throw new RuntimeError(
        XppErrorCodes.BufferNotSelectedForUpdate,
        `There is no ${buffer.tableName} record to ${verb === "updated" ? "update" : "delete"}.`,
        "The select found nothing, so the buffer is empty. Check the `where` clause before writing.",
        "Error",
        span,
      );
    }

    // VB-003: the forUpdate check.
    if (!buffer.selectedForUpdate) {
      throw new RuntimeError(
        XppErrorCodes.BufferNotSelectedForUpdate,
        `The ${buffer.tableName} record cannot be ${verb} because it was not selected for update.`,
        "Add `forupdate` to the select that read this buffer. A buffer read without it is read-only.",
        "Error",
        span,
      );
    }

    /**
     * VB-004: the ttsLevel check.
     *
     * The scope the record was selected in must still be open. Enforced as "still open"
     * rather than "is the innermost", so selecting in an outer transaction and writing
     * inside a nested one is allowed — the documented failure is two sibling blocks, and
     * inventing a stricter rule than the source states would produce false errors. The
     * nested case is logged in docs/unverified.md.
     */
    if (
      buffer.selectedInScope !== undefined &&
      !this.#openScopes.includes(buffer.selectedInScope)
    ) {
      throw new RuntimeError(
        XppErrorCodes.BufferNotSelectedForUpdate,
        `The ${buffer.tableName} record was selected for update in a different transaction scope.`,
        "A record has to be selected for update and written in the same `ttsbegin`/`ttscommit` block. Move the select inside this one.",
        "Error",
        span,
      );
    }
  }

  #new(expression: Extract<Expression, { kind: "new" }>): XppValue {
    const name = expression.className.toLowerCase();

    if (name === "list")
      return { type: "collection", collection: { kind: "List", itemType: "", items: [] } };
    if (name === "set")
      return { type: "collection", collection: { kind: "Set", itemType: "", items: [] } };
    if (name === "map") {
      return {
        type: "collection",
        collection: { kind: "Map", keyType: "", valueType: "", entries: [] },
      };
    }

    throw new RuntimeError(
      XppErrorCodes.ObjectNotFound,
      `There is no class called '${expression.className}'.`,
      "User-defined classes arrive with the customisation track. `List`, `Map` and `Set` are available now.",
      "Error",
      expression.span,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compare(left: XppValue, right: XppValue): number {
  if (left.type === "str" && right.type === "str") {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.type === "date" && right.type === "date") {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  const a = toNumber(left);
  const b = toNumber(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** X++ `like` uses `*` for many and `?` for one. */
function likeMatches(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  return regex.test(text);
}

/** Wraps an already-evaluated value so it can be fed back through `#binary`. */
function literalOf(value: XppValue): Expression {
  const span = {
    start: { line: 0, column: 0, offset: 0 },
    end: { line: 0, column: 0, offset: 0 },
  };
  if (value.type === "str") {
    return { kind: "literal", literalType: "str", value: value.value, raw: value.value, span };
  }
  const numeric = toNumber(value);
  return {
    kind: "literal",
    literalType: value.type === "real" ? "real" : "int",
    value: numeric,
    raw: String(numeric),
    span,
  };
}

/**
 * Splits `SELECT a, b FROM …` into its select list and everything after `FROM`.
 *
 * Safe on a single split because every column the compiler emits is `alias.COLUMN` or
 * `AGG(alias.COLUMN)` — none can contain the word FROM.
 */
function splitSelect(sql: string, span: SourceSpan): [string, string] {
  // `[\s\S]` rather than `.` with the `s` flag: no dependency on the compile target.
  const match = /^SELECT ([\s\S]+?) (FROM [\s\S]+)$/.exec(sql);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new RuntimeError(
      XppErrorCodes.ConstructOutsideSubset,
      "This select cannot be used as the source of an insert_recordset.",
      "Use a plain `select field, field from buffer where …` as the source.",
      "Error",
      span,
    );
  }
  return [match[1], match[2]];
}

/**
 * Pulls the WHERE out of a compiled SELECT so `update_recordset` and `delete_from` can
 * reuse it. The alias prefixes are stripped because a single-table UPDATE has no alias.
 */
function extractWhere(sql: string, alias: string): string | undefined {
  const match = /\bWHERE\b([\s\S]*?)(?:\s+(?:ORDER BY|GROUP BY|LIMIT)\b|$)/.exec(sql);
  if (match?.[1] === undefined) return undefined;
  return match[1].trim().replaceAll(`${alias}.`, "");
}

export { formatString };
