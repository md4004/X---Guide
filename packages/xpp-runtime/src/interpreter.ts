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
import {
  parse,
  type Expression,
  type SelectClauses,
  type SourceUnit,
  type Statement,
  type TypeReference,
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
import { createVirtualAot, validateWrite, type VirtualAot } from "@xpplab/virtual-aot";
import { callBuiltin, formatString, isBuiltin } from "./builtins";
import { STUB_SOURCE } from "./stubs";
import {
  QueryCompileError,
  addDataSource,
  addRange,
  createQuery,
  findDataSource,
  findRange,
  queryToSelectClauses,
  type QueryRunState,
} from "./query";
import { CocError, type ResolvedChain } from "./coc";
import {
  ClassTableError,
  allFields,
  buildClassTable,
  canAccess,
  findField,
  findMethod,
  isSubclassOf,
  type RuntimeClass,
  type RuntimeMethod,
} from "./classes";
import {
  DebugController,
  type DebugField,
  type DebugFrame,
  type DebugHost,
  type DebugPause,
  type DebugVariable,
  type PauseReason,
} from "./debug";
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
  type ObjectInstance,
  type QueryObject,
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
  /**
   * The metadata model `validateWrite()` checks against. Defaults to the authored
   * baseline; a caller supplies one when a lesson has extended it.
   */
  aot?: VirtualAot;
  /**
   * Attaches the debugger. Absent means an ordinary run, which pays nothing for the
   * feature — no state is gathered and no promise is awaited per statement.
   */
  debug?: DebugHost;
  /**
   * Classes available before a line of learner code is parsed.
   *
   * This is how the teaching stubs arrive — our own minimal stand-ins for standard classes
   * like `SRSReportDataProviderBase`, so a lesson can write `extends` against something
   * real without shipping Microsoft source. See CLAUDE.md > Legal rule.
   */
  classes?: ReadonlyMap<string, RuntimeClass>;
  /**
   * The name of the outermost call-stack frame.
   *
   * The Studio passes its startup object; the playground has no such thing, so the frame
   * is named for what it is. This engine executes one top-level statement list and does
   * not yet call user-defined methods, so there is exactly one frame — see Phase 8.
   */
  entryPoint?: string;
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
  /**
   * `true` when the learner pressed Stop Debugging rather than the code finishing.
   *
   * Deliberately not an error: stopping a debug session is a normal thing to do, and
   * dressing it up as a failure would teach the opposite.
   */
  stoppedByDebugger?: boolean;
  /**
   * Every Chain of Command the run actually resolved.
   *
   * Collected during execution rather than derived from the source, so what the visualiser
   * draws is what really ran — including which link declined to pass the result on.
   */
  chains?: ResolvedChain[];
}

/**
 * One entry on the interpreter's own stack.
 *
 * `chain` is present only while a Chain of Command wrapper is running: it is what `next`
 * continues into, and it is why `next` is a statement the interpreter understands rather
 * than an ordinary call it could look up.
 */
interface Frame {
  owner: RuntimeClass | undefined;
  self: ObjectInstance | undefined;
  chain?: { links: RuntimeMethod[]; index: number };
}

/** Non-local control flow. None of these escape `run`. */
class BreakSignal {}
class ContinueSignal {}
class RetrySignal {}
class ReturnSignal {
  constructor(readonly value: XppValue) {}
}
/** Stop Debugging. Unwinds the run without recording an error — see `stoppedByDebugger`. */
class DebugStopSignal {}

export async function run(options: RunOptions): Promise<RunResult> {
  const interpreter = new Interpreter(options);
  return interpreter.execute();
}

export class Interpreter {
  readonly infolog: Infolog = createInfolog();
  readonly #options: RunOptions;
  readonly #db: VirtualDb;
  readonly #aot: VirtualAot;
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

  /**
   * The call stack, outermost first. One frame today, because user-defined methods are
   * Phase 8 — but the debugger's step-over and step-out are written against depth rather
   * than against the assumption that there is only ever one frame.
   */
  readonly #callStack: DebugFrame[];
  readonly #debug: DebugController | undefined;
  #stoppedByDebugger = false;

  /** Chains resolved during this run, keyed `Target.method`, for the visualiser. */
  readonly #chains = new Map<string, ResolvedChain>();

  /** Declared classes, by lowercased name. Filled in `execute`. */
  #classes = new Map<string, RuntimeClass>();

  /**
   * The class whose code is currently running, and the instance it is running on.
   *
   * `undefined` at the top level, which is what makes a script an outsider: it sees the
   * public surface of a class and nothing else (VB-038). Pushed and popped around every
   * method call, so access is judged from where the call is made rather than from where
   * the object came from.
   */
  #frames: Frame[] = [{ owner: undefined, self: undefined }];

  get #frame(): Frame {
    return this.#frames[this.#frames.length - 1]!;
  }

  constructor(options: RunOptions) {
    this.#options = options;
    this.#db = options.db;
    this.#aot = options.aot ?? createVirtualAot();
    this.#scope = this.#globals;
    this.#today = options.today ?? "2026-08-10";
    this.#maxStatements = options.maxStatements ?? EXECUTION_LIMITS.maxStatements;
    this.#deadline = Date.now() + (options.timeoutMs ?? EXECUTION_LIMITS.timeoutMs);
    this.#callStack = [{ name: options.entryPoint ?? "(script)", line: 0 }];
    this.#debug = options.debug === undefined ? undefined : new DebugController(options.debug);
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
      // Classes are registered before any statement runs, so a job at the top of the file
      // can call a class declared at the bottom of it. X++ has no ordering rule here.
      // The teaching stubs first, so a learner's class can extend one. Parsed rather
      // than hand-built: a stub written in X++ behaves like X++.
      const stubs = parse(STUB_SOURCE);
      const stubTable = buildClassTable(stubs.ast?.declarations ?? []);

      this.#classes = buildClassTable(
        this.#options.ast.declarations,
        this.#options.classes ?? stubTable,
      );
      await this.#initialiseStatics();

      for (const statement of this.#options.ast.statements) {
        await this.#statement(statement);
      }
    } catch (error) {
      await this.#handleTopLevel(error);
    }

    // VB-007's cousin: work left uncommitted at the end of a run is a defect in F&O,
    // and silently committing it would teach the opposite.
    //
    // Stopping the debugger is the exception. Code abandoned halfway is *expected* to be
    // mid-transaction, and reporting it as a defect would punish the learner for using
    // the button. The work is still rolled back — it just is not an error.
    const depth = this.#transactionDepth;
    if (depth > 0 && this.#stoppedByDebugger) {
      await this.#db.abortTransaction().catch(() => undefined);
      this.#transactionDepth = 0;
    } else if (depth > 0) {
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
      ...(this.#stoppedByDebugger ? { stoppedByDebugger: true } : {}),
      ...(this.#chains.size === 0 ? {} : { chains: [...this.#chains.values()] }),
    };
  }

  async #handleTopLevel(error: unknown): Promise<void> {
    // Stop Debugging. The learner asked for this, so it is not a failure — the abort of
    // any open transaction happens in `execute`, which owns that decision.
    if (error instanceof DebugStopSignal) return;

    // A malformed class hierarchy is a compile-time failure in a real environment, so it
    // is reported before any statement runs rather than as a runtime surprise.
    if (error instanceof ClassTableError || error instanceof CocError) {
      this.#errors.push({
        code: XppErrorCodes.ConstructOutsideSubset,
        message: error.message,
        line: 1,
        column: 1,
        hint: error.hint,
      });
      return;
    }

    if (error instanceof ThrownException) {
      // An uncaught throw ends the run. The message was already written to the Infolog
      // by error()/warning(), so do not write it twice (VB-010).
      //
      // Whether a transaction was open when it escaped changes the advice entirely, and
      // it is the single most confusing rule in X++ exception handling (VB-008): a
      // `catch` that sits inside the transaction never sees the exception, so a learner
      // who wrote one is staring at code that looks like it should have worked.
      const insideTransaction = this.#transactionDepth > 0 || error.escapedTransaction;
      await this.#abortOpenTransaction();

      this.#errors.push({
        code: XppErrorCodes.UnhandledException,
        message:
          error.message.length > 0
            ? `Unhandled exception: ${error.message}`
            : `Unhandled Exception::${error.xppException}.`,
        line: error.span?.start.line ?? this.#currentLine,
        column: error.span?.start.column ?? 1,
        hint: insideTransaction
          ? "This was thrown inside a transaction, and an exception thrown inside a transaction cannot be caught by a catch that is also inside it. Move the try so that it wraps the ttsbegin rather than sitting within it."
          : "Wrap the code in `try { … } catch (Exception::Error) { … }` to handle this yourself.",
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

  // -- the query object model ----------------------------------------------

  /**
   * `tableNum(X)`, `fieldNum(X, F)` and `queryValue(v)`.
   *
   * Handled before arguments are evaluated, because their arguments are *names*, not
   * values — `tableNum(InventTable)` names a table, and evaluating `InventTable` as a
   * variable would fail. The real compiler resolves these at compile time for the same
   * reason.
   *
   * They answer with the name as a string. A real environment answers with a numeric id
   * out of its own id space, and this simulator has no such space — inventing numbers
   * that look like real table ids would be worse than a visible difference. Nobody writes
   * the literal in either case; that is the whole point of the function.
   */
  #compileTimeName(expression: Extract<Expression, { kind: "call" }>): XppValue | undefined {
    if (expression.callee.kind !== "identifier") return undefined;

    const name = expression.callee.name.toLowerCase();
    const nameOf = (argument: Expression | undefined): string =>
      argument === undefined
        ? ""
        : argument.kind === "identifier"
          ? argument.name
          : argument.kind === "literal"
            ? String(argument.value)
            : "";

    if (name === "tablenum" || name === "tablestr") {
      const table = nameOf(expression.arguments[0]);
      if (getTableSchema(table as TableName) === undefined) {
        throw new RuntimeError(
          XppErrorCodes.ObjectNotFound,
          `There is no table called '${table}'.`,
          "`tableNum` is checked at compile time in a real environment, which is why a typo here is caught before the code ever runs.",
          "Error",
          expression.span,
        );
      }
      return str(table);
    }

    if (name === "fieldnum" || name === "fieldstr") {
      const table = nameOf(expression.arguments[0]);
      const field = nameOf(expression.arguments[1]);
      const schema = getTableSchema(table as TableName);
      const known =
        schema !== undefined &&
        [RECID_FIELD, DATAAREAID_FIELD, ...schema.fields.map((entry) => entry.name)].some(
          (candidate) => candidate.toLowerCase() === field.toLowerCase(),
        );

      if (!known) {
        throw new RuntimeError(
          XppErrorCodes.FieldNotFound,
          `'${table}' has no field called '${field}'.`,
          "`fieldNum` is compile-time checked in a real environment — this is the error you would get at build time.",
          "Error",
          expression.span,
        );
      }
      return str(field);
    }

    return undefined;
  }

  /** Methods on `Query`, `QueryBuildDataSource`, `QueryBuildRange` and `QueryRun`. */
  async #queryMethod(
    holder: QueryObject,
    method: string,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const name = method.toLowerCase();
    const text = (index: number): string => toDisplayString(args[index] ?? NULL);

    if (holder.kind === "Query") {
      if (name === "adddatasource") {
        return {
          type: "queryObject",
          object: {
            kind: "QueryBuildDataSource",
            dataSource: addDataSource(holder.query, text(0)),
          },
        };
      }
      if (name === "datasourcetable") {
        const found = findDataSource(holder.query, text(0));
        return found === undefined
          ? NULL
          : { type: "queryObject", object: { kind: "QueryBuildDataSource", dataSource: found } };
      }
    }

    if (holder.kind === "QueryBuildDataSource") {
      if (name === "addrange") {
        return {
          type: "queryObject",
          object: { kind: "QueryBuildRange", range: addRange(holder.dataSource, text(0)) },
        };
      }
      if (name === "findrange") {
        const found = findRange(holder.dataSource, text(0));
        return found === undefined
          ? NULL
          : { type: "queryObject", object: { kind: "QueryBuildRange", range: found } };
      }
      if (name === "addsortfield") {
        const direction =
          args[1] !== undefined && toDisplayString(args[1]).toLowerCase() === "descending"
            ? "desc"
            : "asc";
        holder.dataSource.sortFields.push({ field: text(0), direction });
        return VOID;
      }
      if (name === "adddatasource" || name === "joinmode" || name === "relations") {
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          `'${method}' joins one query data source to another, which is not simulated.`,
          "This engine's query objects cover one data source with ranges and sorting. Write the join as `while select ... join ...` — the SQL trace shows they are the same thing.",
          "Error",
          span,
        );
      }
    }

    if (holder.kind === "QueryBuildRange") {
      // `value()` with no argument reads, with one it writes — the parm shape again.
      if (name === "value") {
        if (args.length === 0) return str(holder.range.value);
        holder.range.value = text(0);
        return str(holder.range.value);
      }
    }

    if (holder.kind === "SrsReportRunController") {
      // `ssrsReportStr(ItemSalesReport, Report)` arrives already flattened to a string.
      if (name === "parmreportname") {
        if (args.length > 0) holder.controller.reportName = text(0);
        return str(holder.controller.reportName);
      }
      // A real controller takes the caller's Args to find the record it was opened from.
      // There is no menu item here, so there is nothing to carry — and saying so beats
      // accepting it silently and implying it did something.
      if (name === "parmargs") return VOID;
      if (name === "startoperation") return this.#startReport(holder.controller, span);
    }

    if (holder.kind === "QueryRun") {
      if (name === "next") return this.#queryRunNext(holder.run, span);
      if (name === "get") {
        const table = text(0);
        const values = holder.run.rows?.[holder.run.cursor - 1];
        const columns = holder.run.columns ?? [];

        const row: Row = {};
        if (values !== undefined) {
          for (const [index, column] of columns.entries()) row[column] = values[index] ?? null;
        }

        return {
          type: "buffer",
          buffer: {
            tableName: table,
            selectedForUpdate: false,
            isEmpty: values === undefined,
            ...(values === undefined ? {} : { row }),
          },
        };
      }
    }

    throw new RuntimeError(
      XppErrorCodes.MethodNotFound,
      `'${method}' is not available on ${holder.kind}.`,
      "See docs/language-subset.md for the query methods this engine simulates.",
      "Error",
      span,
    );
  }

  /**
   * `queryRun.next()`.
   *
   * The query is compiled and executed on the first call, then walked from memory — which
   * is what makes the SQL trace show **one** statement for the whole loop rather than one
   * per row.
   */
  async #queryRunNext(run: QueryRunState, span: SourceSpan): Promise<XppValue> {
    if (!run.started) {
      run.started = true;

      let clauses;
      try {
        clauses = queryToSelectClauses(run.query);
      } catch (error) {
        if (error instanceof QueryCompileError) {
          throw new RuntimeError(
            XppErrorCodes.ConstructOutsideSubset,
            error.message,
            error.hint,
            "Error",
            span,
          );
        }
        throw error;
      }

      const table = run.query.dataSources[0]!.table as TableName;
      const compiled = selectToSql(clauses, {
        company: this.#db.getCompany() as CompanyId,
        resolveBuffer: (name) => (name === run.query.dataSources[0]!.buffer ? table : undefined),
      });

      if (!isCompiled(compiled)) {
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          compiled.errors[0]?.message ?? "This query could not be compiled.",
          compiled.errors[0]?.hint ?? "Check the ranges you added.",
          "Error",
          span,
        );
      }

      const result = await this.#exec(compiled.sql, compiled.parameters, span, "QueryRun.next()");
      run.rows = result.rows;
      run.columns = compiled.outputs[run.query.dataSources[0]!.buffer] ?? [];
      run.cursor = 0;
    }

    if (run.cursor >= (run.rows?.length ?? 0)) return bool(false);
    run.cursor += 1;
    return bool(true);
  }

  // -- the report framework ------------------------------------------------

  /**
   * `SrsReportRunController.startOperation()`.
   *
   * This is the sequence a learner never writes and always depends on. The controller was
   * given a report *name* and nothing else; everything it needs comes from the report
   * element in the AOT:
   *
   *   1. resolve the report, and through it the data provider class
   *   2. construct the provider
   *   3. hand it the query the report declares       — `parmQuery()`
   *   4. hand it the contract, if the provider has one — `parmDataContract()`
   *   5. call `processReport()`, which is the learner's code
   *   6. read the dataset back through the method carrying `[SRSReportDataSetAttribute]`
   *
   * Step 5 is the only one in the learner's hands, and steps 3, 4 and 6 are why the
   * attributes exist. Running it for real is what makes that concrete.
   */
  async #startReport(
    controller: { reportName: string; ran: boolean },
    span: SourceSpan,
  ): Promise<XppValue> {
    if (controller.reportName === "") {
      throw new RuntimeError(
        XppErrorCodes.ObjectNotFound,
        "The controller has no report name, so there is nothing to run.",
        "Call `controller.parmReportName(ssrsReportStr(YourReport, Report));` before startOperation().",
        "Error",
        span,
      );
    }

    // `Report.Design` is how a report name is written; the report element is the first half.
    const reportName = controller.reportName.split(".")[0]!;
    const report = this.#aot.getReport(reportName);

    if (report === undefined) {
      throw new RuntimeError(
        XppErrorCodes.ObjectNotFound,
        `There is no report called '${reportName}'.`,
        "A report is an AOT element, not a class. The controller finds the data provider through it, which is why the name has to match.",
        "Error",
        span,
      );
    }

    const provider = this.#lookupClass(report.dataProviderClass);
    if (provider === undefined) {
      throw new RuntimeError(
        XppErrorCodes.ObjectNotFound,
        `'${report.name}' names '${report.dataProviderClass}' as its data provider, and no such class is declared.`,
        `Declare \`class ${report.dataProviderClass} extends SRSReportDataProviderBase\` with a processReport() method.`,
        "Error",
        span,
      );
    }

    const instance = await this.#construct(provider, [], span);
    if (instance.type !== "object") return VOID;

    // 3. The query the report declares, built the way a query object is built anywhere.
    const query = createQuery();
    addDataSource(query, report.queryTable);
    if (findMethod(provider, "parmQuery") !== undefined) {
      await this.#callInstanceMethod(
        instance.instance,
        "parmQuery",
        [{ type: "queryObject", object: { kind: "Query", query } }],
        span,
      );
    }

    // 5. The learner's code.
    if (findMethod(provider, "processReport") === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${provider.name}' has no processReport() method, so the framework has nothing to call.`,
        "The base class declares an empty one; override it with `public void processReport()` and fill the table there.",
        "Error",
        span,
      );
    }
    await this.#callInstanceMethod(instance.instance, "processReport", [], span);

    // 6. The dataset getter is found by its attribute, not by its name — which is the
    // point of the attribute, and why renaming the method breaks nothing.
    const getter = [...provider.methods.values()].find((method) =>
      method.declaration.attributes.some(
        (attribute) => attribute.name.toLowerCase() === "srsreportdatasetattribute",
      ),
    );

    if (getter === undefined) {
      this.infolog.add(
        "warning",
        `${provider.name} filled the table, but no method carries [SRSReportDataSetAttribute], so a design would have nothing to bind to.`,
        span.start.line,
      );
    } else {
      await this.#callInstanceMethod(instance.instance, getter.name, [], span);
    }

    controller.ran = true;
    this.infolog.add(
      "info",
      `Report ${report.name} ran: ${report.dataProviderClass}.processReport() filled ${report.table}.`,
      span.start.line,
    );

    return VOID;
  }

  // -- classes -------------------------------------------------------------

  /** Static fields exist once per class, so they are created before anything runs. */
  async #initialiseStatics(): Promise<void> {
    for (const runtime of this.#classes.values()) {
      for (const field of runtime.fields.values()) {
        if (field.isStatic)
          runtime.statics.set(field.name.toLowerCase(), defaultValueFor(field.type.name));
      }
    }
  }

  #lookupClass(name: string): RuntimeClass | undefined {
    return this.#classes.get(name.toLowerCase());
  }

  /**
   * Builds an instance and runs its constructor.
   *
   * Fields come from the whole chain, so an inherited field exists on the instance even
   * though the subclass never mentioned it.
   */
  async #construct(runtime: RuntimeClass, args: XppValue[], span: SourceSpan): Promise<XppValue> {
    if (runtime.isAbstract) {
      throw new RuntimeError(
        XppErrorCodes.ObjectNotFound,
        `'${runtime.name}' is abstract, so it cannot be instantiated.`,
        "An abstract class exists to be extended. Instantiate one of its subclasses instead.",
        "Error",
        span,
      );
    }

    const instance: ObjectInstance = { className: runtime.name, fields: new Map() };
    for (const field of allFields(runtime)) {
      // `#initialValue`, not `defaultValueFor`: a field declared as a table gets a real
      // empty buffer, exactly as a local of that type would. Without this, a data
      // provider whose temp table is a class field has a null where its buffer should be.
      if (!field.isStatic)
        instance.fields.set(field.name.toLowerCase(), this.#initialValue(field.type));
    }

    // VB-042: a class may declare one `new`. Without one there is a parameterless default,
    // which is why an absent constructor is not an error.
    const constructor = findMethod(runtime, "new");
    if (constructor !== undefined) {
      this.#requireAccess(constructor, runtime, span, "constructor");
      await this.#invoke(constructor, instance, args, span);
    } else if (args.length > 0) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${runtime.name}' has no 'new' method, so it takes no arguments.`,
        "Declare `public void new(...)` on the class to accept construction parameters.",
        "Error",
        span,
      );
    }

    return { type: "object", instance };
  }

  #requireAccess(
    method: RuntimeMethod,
    _owner: RuntimeClass,
    span: SourceSpan,
    what = "method",
  ): void {
    if (canAccess(method.access, method.declaringClass, this.#frame.owner)) return;

    const from =
      this.#frame.owner === undefined
        ? "from outside the class"
        : `from '${this.#frame.owner.name}'`;

    throw new RuntimeError(
      XppErrorCodes.MethodNotFound,
      `'${method.name}' is ${method.access} in '${method.declaringClass.name}' and cannot be called ${from}.`,
      method.access === "private"
        ? `A private ${what} is callable only from methods of the class that declares it. Note that in X++ a method with no access modifier is public — private has to be written.`
        : `A protected ${what} is callable from its own class and from subclasses of it.`,
      "Error",
      span,
    );
  }

  /**
   * Runs a method body in its own scope and frame.
   *
   * The frame is what makes access checks mean anything: while this body runs, `private`
   * and `protected` are judged against `method.declaringClass`, not against wherever the
   * call came from. It also pushes a real call-stack entry, which is what turns the
   * debugger's Step Into from a no-op into the thing it is for.
   */
  async #invoke(
    method: RuntimeMethod,
    self: ObjectInstance | undefined,
    args: XppValue[],
    span: SourceSpan,
    chain?: { links: RuntimeMethod[]; index: number },
  ): Promise<XppValue> {
    if (method.isAbstract) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${method.name}' is abstract in '${method.declaringClass.name}' and has no body.`,
        "A subclass must override it before it can be called.",
        "Error",
        span,
      );
    }

    if (this.#frames.length > EXECUTION_LIMITS.maxCallDepth) {
      throw new BudgetExceeded(
        XppErrorCodes.StatementBudgetExceeded,
        `Call depth passed ${EXECUTION_LIMITS.maxCallDepth}.`,
        "That is almost always unbounded recursion — check that the method has a case where it stops calling itself.",
      );
    }

    const outerScope = this.#scope;
    this.#scope = this.#globals.child();
    this.#frames.push({
      owner: method.declaringClass,
      self,
      ...(chain === undefined ? {} : { chain }),
    });
    this.#callStack.push({
      name: `${method.declaringClass.name}.${method.name}`,
      line: span.start.line,
    });

    try {
      // VB-045: a parameter with a default is optional, and the default is evaluated in
      // the callee's scope — which is what lets `parmX(int _x = x)` read the field.
      for (const [index, parameter] of method.declaration.parameters.entries()) {
        const supplied = args[index];
        const value =
          supplied ??
          (parameter.defaultValue === undefined
            ? this.#initialValue(parameter.type)
            : await this.#evaluate(parameter.defaultValue));
        this.#scope.declare(parameter.name, value, parameter.type.name);
      }

      if (args.length > method.declaration.parameters.length) {
        throw new RuntimeError(
          XppErrorCodes.MethodNotFound,
          `'${method.name}' takes ${method.declaration.parameters.length} parameter${method.declaration.parameters.length === 1 ? "" : "s"}, but ${args.length} were supplied.`,
          "Check the method's declaration.",
          "Error",
          span,
        );
      }

      await this.#statement(method.declaration.body);

      // VB-037: reaching the end of a method is an implicit return. A method with a
      // declared return type that falls off the end yields its type's default, which is
      // what X++ does rather than failing.
      return method.declaration.returnType.name.toLowerCase() === "void"
        ? VOID
        : defaultValueFor(method.declaration.returnType.name);
    } catch (error) {
      // A method is statically typed, so what it returns is its declared type — a `real`
      // method returning the literal `100` hands back 100.00, not an int that prints as
      // "100". Without this the difference shows up in the Infolog and looks like a
      // formatting bug rather than a typing one.
      if (error instanceof ReturnSignal) {
        return coerceToDeclaredType(method.declaration.returnType.name, error.value);
      }
      throw error;
    } finally {
      this.#callStack.pop();
      this.#frames.pop();
      this.#scope = outerScope;
    }
  }

  /** `obj.method(args)` and `this.method(args)`. */
  async #callInstanceMethod(
    instance: ObjectInstance,
    name: string,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const runtime = this.#lookupClass(instance.className)!;
    const method = findMethod(runtime, name);

    if (method === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${instance.className}' has no method called '${name}'.`,
        `Declared methods: ${this.#methodNames(runtime).join(", ") || "none"}.`,
        "Error",
        span,
      );
    }

    // VB-040: a static method is not invoked on an instance.
    if (method.isStatic) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${name}' is static, so it is called on the class rather than on an instance.`,
        `Write ${method.declaringClass.name}::${method.name}(...) instead.`,
        "Error",
        span,
      );
    }

    this.#requireAccess(method, runtime, span);
    return this.#invokeChain(runtime, method, instance, args, span);
  }

  /**
   * Runs a method through its Chain of Command, if anything wrapped it.
   *
   * The wrappers come first and the original implementation is the tail. Any link can
   * decline to pass on what the rest returned — which compiles, and is the defect the
   * customisation lesson is built around.
   *
   * The order among wrappers is **not** a guarantee (VB-063). They run in declaration
   * order here because something has to go first; nothing in the product promises that,
   * and the visualiser says so.
   */
  async #invokeChain(
    owner: RuntimeClass,
    method: RuntimeMethod,
    self: ObjectInstance | undefined,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const wrappers = this.#wrappersFor(owner, method.name);
    if (wrappers.length === 0) return this.#invoke(method, self, args, span);

    this.#recordChain(owner, method, wrappers);
    return this.#runChainLink([...wrappers, method], 0, self, args, span);
  }

  /**
   * Notes a resolved chain for the visualiser, once per method.
   *
   * `orderIsUndefined` is set the moment there is more than one wrapper, because that is
   * exactly when the sequence stops being knowable (VB-063). Drawing a confident order
   * would be the most damaging thing this diagram could do — it is the assumption the
   * documentation explicitly denies.
   */
  #recordChain(owner: RuntimeClass, method: RuntimeMethod, wrappers: RuntimeMethod[]): void {
    const key = `${owner.name}.${method.name}`;
    if (this.#chains.has(key)) return;

    this.#chains.set(key, {
      target: owner.name,
      methodName: method.name,
      links: [
        ...wrappers.map((wrapper) => ({
          kind: "wrapper" as const,
          declaringClass: wrapper.declaringClass.name,
          methodName: wrapper.name,
        })),
        {
          kind: "base" as const,
          declaringClass: method.declaringClass.name,
          methodName: method.name,
        },
      ],
      orderIsUndefined: wrappers.length > 1,
    });
  }

  /**
   * Every wrapper registered against this method, looked up along the inheritance chain.
   *
   * An extension of a derived class may wrap a method declared on its base (VB-066), and
   * only instances of that derived class get the wrapper — which falls out of starting the
   * search at the instance's own class.
   */
  #wrappersFor(runtime: RuntimeClass, name: string): RuntimeMethod[] {
    const own = runtime.wrappers.get(name.toLowerCase()) ?? [];
    const inherited = runtime.base === undefined ? [] : this.#wrappersFor(runtime.base, name);
    return [...own, ...inherited];
  }

  async #runChainLink(
    links: RuntimeMethod[],
    index: number,
    self: ObjectInstance | undefined,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const link = links[index];
    if (link === undefined) return VOID;

    return this.#invoke(link, self, args, span, { links, index });
  }

  /** `ClassName::method(args)`. */
  async #callStaticMethod(
    className: string,
    name: string,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const runtime = this.#lookupClass(className)!;
    const method = findMethod(runtime, name);

    if (method === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${className}' has no method called '${name}'.`,
        `Declared methods: ${this.#methodNames(runtime).join(", ") || "none"}.`,
        "Error",
        span,
      );
    }

    if (!method.isStatic) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${name}' is an instance method, so it needs an object to run on.`,
        `Create one with \`new ${runtime.name}()\` and call it on that, or declare the method \`static\`.`,
        "Error",
        span,
      );
    }

    this.#requireAccess(method, runtime, span);
    return this.#invoke(method, undefined, args, span);
  }

  #methodNames(runtime: RuntimeClass): string[] {
    const names = [...runtime.methods.values()].map((method) => method.name);
    return runtime.base === undefined ? names : [...names, ...this.#methodNames(runtime.base)];
  }

  /**
   * Reads a field off an instance, enforcing its access.
   *
   * A field is protected by default (VB-035), so this is where a learner who assumed the
   * C# rule finds out — reading `point.x` from a job fails unless `x` was written
   * `public`, and the message says so.
   */
  #readField(instance: ObjectInstance, name: string, span: SourceSpan): XppValue {
    const runtime = this.#lookupClass(instance.className)!;
    const field = findField(runtime, name);

    if (field === undefined) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `'${instance.className}' has no field called '${name}'.`,
        "Check the spelling, or use an accessor method if the value is meant to be read through one.",
        "Error",
        span,
      );
    }

    if (!canAccess(field.access, field.declaringClass, this.#frame.owner)) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `'${name}' is ${field.access} in '${field.declaringClass.name}' and cannot be read here.`,
        "Fields in X++ are protected unless you write `public`. The usual fix is an accessor method — the `parm` convention exists for exactly this.",
        "Error",
        span,
      );
    }

    if (field.isStatic) return field.declaringClass.statics.get(name.toLowerCase()) ?? NULL;
    return instance.fields.get(name.toLowerCase()) ?? NULL;
  }

  #writeField(instance: ObjectInstance, name: string, value: XppValue, span: SourceSpan): void {
    const runtime = this.#lookupClass(instance.className)!;
    const field = findField(runtime, name);

    if (field === undefined) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `'${instance.className}' has no field called '${name}'.`,
        "Fields have to be declared in the class body before they can be assigned.",
        "Error",
        span,
      );
    }

    if (!canAccess(field.access, field.declaringClass, this.#frame.owner)) {
      throw new RuntimeError(
        XppErrorCodes.FieldNotFound,
        `'${name}' is ${field.access} in '${field.declaringClass.name}' and cannot be assigned here.`,
        "Fields in X++ are protected unless you write `public`. Expose a setter instead of widening the field.",
        "Error",
        span,
      );
    }

    if (field.isStatic) field.declaringClass.statics.set(name.toLowerCase(), value);
    else instance.fields.set(name.toLowerCase(), value);
  }

  /**
   * `super()` or `super.method()`.
   *
   * Resolution starts at the base of the class whose method is *declared here*, not at
   * the base of the instance's class. Starting from the instance would find this method
   * again on the way up and recurse forever, which is the classic way to get this wrong.
   */
  async #callSuper(
    member: string | undefined,
    args: XppValue[],
    span: SourceSpan,
  ): Promise<XppValue> {
    const owner = this.#frame.owner;
    const self = this.#frame.self;

    if (owner === undefined || self === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        "`super` is only available inside an instance method.",
        "It calls the base class's version of the method you are in, so there has to be a method to be inside.",
        "Error",
        span,
      );
    }

    if (owner.base === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${owner.name}' does not extend anything, so it has no \`super\` to call.`,
        "Add `extends SomeClass` to the declaration, or call the method directly.",
        "Error",
        span,
      );
    }

    // A bare `super()` means "the base's version of the method I am in", which is why the
    // frame has to remember the method name as well as the class.
    const name = member ?? this.#callStack[this.#callStack.length - 1]!.name.split(".").pop()!;
    const method = findMethod(owner.base, name);

    if (method === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `'${owner.base.name}' has no method called '${name}' to call with \`super\`.`,
        "A `super` call needs the base class to declare the method you are overriding.",
        "Error",
        span,
      );
    }

    return this.#invoke(method, self, args, span);
  }

  /**
   * `next someMethod(args)` — continue into the rest of the Chain of Command.
   *
   * The frame knows where in the chain it is, which is why this is a statement the
   * interpreter understands rather than a call it could resolve by name: `next` does not
   * name a method to find, it names the position after this one.
   */
  async #next(statement: Extract<Statement, { kind: "nextCall" }>): Promise<XppValue> {
    return this.#continueChain(statement.arguments, statement.span);
  }

  /** Shared by the statement and expression forms of `next`. */
  async #continueChain(argumentNodes: Expression[], span: SourceSpan): Promise<XppValue> {
    const chain = this.#frame.chain;

    if (chain === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        "`next` is only available inside a Chain of Command wrapper.",
        "A wrapper is a method on a class marked `[ExtensionOf(...)]` whose name matches a method on the class it extends.",
        "Error",
        span,
      );
    }

    const args: XppValue[] = [];
    for (const argument of argumentNodes) args.push(await this.#evaluate(argument));

    return this.#runChainLink(chain.links, chain.index + 1, this.#frame.self, args, span);
  }

  /** The instance `this` refers to, or a refusal that explains why there is none. */
  #self(span: SourceSpan): ObjectInstance {
    const self = this.#frame.self;
    if (self !== undefined) return self;

    throw new RuntimeError(
      XppErrorCodes.ObjectNotFound,
      "`this` is not available here.",
      this.#frame.owner === undefined
        ? "`this` only means something inside an instance method. At the top level there is no object to refer to."
        : "`this` cannot be used in a static method — a static method runs on the class, not on an instance (VB-041).",
      "Error",
      span,
    );
  }

  // -- debugger ------------------------------------------------------------

  /**
   * Charge the budget for a statement, then give the debugger a chance to stop on it.
   *
   * Every place that used to call `#tick` calls this instead, which is why a loop pauses
   * on its own header line on each iteration rather than only the first time through —
   * the condition really is re-evaluated there, and the real debugger shows that.
   */
  async #at(line: number): Promise<void> {
    this.#tick(line);
    if (this.#debug === undefined) return;

    this.#callStack[this.#callStack.length - 1]!.line = line;

    const outcome = await this.#debug.beforeStatement({
      line,
      depth: this.#callStack.length - 1,
      state: (reason) => this.#debugState(line, reason),
      test: (expression) => this.#testCondition(expression),
    });

    if (outcome === "stop") {
      this.#stoppedByDebugger = true;
      throw new DebugStopSignal();
    }
  }

  async #debugState(line: number, reason: PauseReason): Promise<DebugPause> {
    return {
      reason,
      line,
      statementsExecuted: this.#statements,
      locals: this.#locals(),
      // Innermost first, which is the order the Call Stack window lists frames in.
      callStack: [...this.#callStack].reverse().map((frame) => ({ ...frame })),
      autos: { company: this.#db.getCompany(), transactionLevel: this.#transactionDepth },
      infolog: [...this.infolog.entries()],
    };
  }

  #locals(): DebugVariable[] {
    return this.#scope.visibleBindings().map(({ name, typeName, value }) => {
      const base: DebugVariable = { name, typeName, value: toDisplayString(value) };
      if (value.type !== "buffer") return base;

      const fields = this.#bufferFields(value.buffer);
      return fields === undefined ? base : { ...base, fields };
    });
  }

  /**
   * A table buffer expanded to its fields, the way Locals expands one.
   *
   * VB-024: a field the `select` field list left out reads as `null` in the debugger even
   * though the variable really holds its type's default. That falls straight out of how
   * the engine already works — the row only carries the columns that were selected — so
   * the artifact is reproduced rather than staged.
   */
  #bufferFields(buffer: TableBuffer): DebugField[] | undefined {
    const schema = getTableSchema(buffer.tableName as TableName);
    if (schema === undefined) return undefined;
    if (buffer.isEmpty || buffer.row === undefined) return [];

    const row = buffer.row;
    const columns = [RECID_FIELD, DATAAREAID_FIELD, ...schema.fields.map((field) => field.name)];

    return columns.map((name) => {
      const selected = row[name] !== undefined;
      return {
        name,
        value: selected ? String(row[name]) : "null",
        selected,
      };
    });
  }

  /**
   * Evaluates a breakpoint condition (VB-025) in the paused scope.
   *
   * A condition that does not parse, or that throws, is `false`. A learner mistyping a
   * condition should get a breakpoint that does not fire, not a run that dies — and the
   * real debugger is equally forgiving about it.
   */
  async #testCondition(expression: string): Promise<boolean> {
    try {
      const { ast, errors } = parse(`${expression};`);
      const first = ast?.statements[0];
      if (errors.length > 0 || first === undefined || first.kind !== "expressionStatement") {
        return false;
      }
      return toBoolean(await this.#evaluate(first.expression));
    } catch {
      return false;
    }
  }

  // -- statements ----------------------------------------------------------

  async #statement(statement: Statement): Promise<void> {
    // A block is punctuation, not an executable line. Pausing the debugger on a bare `{`
    // is an artifact of walking the AST — the real debugger steps from a loop header
    // straight into the first statement of the body. It still costs a tick, so the
    // statement budget is unchanged.
    if (statement.kind === "block") this.#tick(statement.span.start.line);
    else await this.#at(statement.span.start.line);

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

      /**
       * The loop cases each land on the header line once per condition test, not once per
       * iteration body.
       *
       * The difference is visible: entering the statement is the first test, and the trip
       * back up after the body is every test after that. Ticking at the top of the body
       * instead would stop twice on the header the first time round, and would never stop
       * on it at all for a loop whose condition is false immediately — both of which teach
       * the wrong thing about when a loop condition is evaluated.
       */
      case "while": {
        for (;;) {
          if (!toBoolean(await this.#evaluate(statement.test))) break;
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
          await this.#at(statement.span.start.line);
        }
        return;
      }

      case "doWhile": {
        for (;;) {
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
          if (!toBoolean(await this.#evaluate(statement.test))) break;
          await this.#at(statement.span.start.line);
        }
        return;
      }

      case "for": {
        if (statement.init !== undefined) await this.#evaluate(statement.init);
        for (;;) {
          if (statement.test !== undefined && !toBoolean(await this.#evaluate(statement.test))) {
            break;
          }
          try {
            await this.#statement(statement.body);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
          if (statement.update !== undefined) await this.#evaluate(statement.update);
          await this.#at(statement.span.start.line);
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
        // A bare `next foo();` — the result is discarded, which is legal and is exactly
        // how a wrapper silently swallows the rest of the chain's answer.
        await this.#next(statement);
        return;

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
          // Remember why this catch was skipped. The transaction is already aborted, so
          // the top-level handler could not work it out for itself — and it is the one
          // thing worth telling the learner if nothing catches it further out.
          if (error instanceof ThrownException) error.escapedTransaction = true;
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

      // A plain variable in a `where` is a host value, bound at the moment the statement
      // runs rather than compiled into the SQL.
      resolveVariable: (name) => {
        const value = this.#scope.get(name);
        return value === undefined || value.type === "buffer" ? undefined : toSqlValue(value);
      },

      // A field on a buffer this statement does not select — the row an outer loop is
      // currently on. Binding it is what makes a nested `while select` work at all.
      resolveBufferField: (bufferName, field) => {
        const value = this.#scope.get(bufferName);
        if (value?.type !== "buffer" || value.buffer.row === undefined) return undefined;
        const schema = getTableSchema(value.buffer.tableName);
        const column = [
          ...(schema?.fields.map((f) => f.name) ?? []),
          RECID_FIELD,
          DATAAREAID_FIELD,
        ].find((name) => name.toLowerCase() === field.toLowerCase());
        return column === undefined ? undefined : (value.buffer.row[column] ?? null);
      },
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
        // `this` is not a variable — it is the frame's instance, and a bare field name
        // inside a method resolves to that instance's field when no local shadows it.
        if (expression.name === "this") {
          return { type: "object", instance: this.#self(expression.span) };
        }

        const local = this.#scope.get(expression.name);
        if (local === undefined) {
          const self = this.#frame.self;
          const owner = this.#frame.owner;
          if (
            self !== undefined &&
            findField(this.#lookupClass(self.className)!, expression.name)
          ) {
            return this.#readField(self, expression.name, expression.span);
          }
          // A static method has no instance, but it can still reach its class's statics.
          if (owner !== undefined) {
            const staticField = findField(owner, expression.name);
            if (staticField?.isStatic === true) {
              return staticField.declaringClass.statics.get(expression.name.toLowerCase()) ?? NULL;
            }
          }
        }

        const value = local;
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

      case "nextExpression":
        return this.#continueChain(expression.arguments, expression.span);

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
      case "as": {
        // `left is Right` asks whether the instance's class is Right or descends from it.
        // `as` is the same question, answering the object or null rather than a boolean.
        const className =
          expression.right.kind === "identifier" ? expression.right.name : undefined;
        const target = className === undefined ? undefined : this.#lookupClass(className);

        if (target === undefined) {
          throw new RuntimeError(
            XppErrorCodes.ObjectNotFound,
            `The right side of '${expression.operator}' must be a class name.`,
            "Write `myObject is MyClass`, naming a class declared in this code.",
            "Error",
            expression.span,
          );
        }

        const matches =
          left.type === "object" &&
          isSubclassOf(this.#lookupClass(left.instance.className)!, target);

        if (expression.operator === "is") return bool(matches);
        return matches ? left : NULL;
      }
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
      if (this.#scope.set(target.name, value)) return;

      // Not a local. Inside a method, a bare name is the instance's field — which is how
      // `parmX(int _x = x) { x = _x; }` assigns without writing `this.` everywhere.
      const self = this.#frame.self;
      if (self !== undefined && findField(this.#lookupClass(self.className)!, target.name)) {
        this.#writeField(self, target.name, value, target.span);
        return;
      }

      const owner = this.#frame.owner;
      const staticField = owner === undefined ? undefined : findField(owner, target.name);
      if (staticField?.isStatic === true) {
        staticField.declaringClass.statics.set(target.name.toLowerCase(), value);
        return;
      }

      throw new RuntimeError(
        XppErrorCodes.UndeclaredIdentifier,
        `'${target.name}' has not been declared.`,
        "X++ has no implicit declaration — give it a type before assigning to it.",
        "Error",
        target.span,
      );
    }

    if (target.kind === "memberAccess") {
      const holder = await this.#evaluate(target.object);

      if (holder.type === "object") {
        this.#writeField(holder.instance, target.member, value, target.span);
        return;
      }

      // Same reason as the method call above: the buffer being written may be a field.
      if (holder.type === "buffer") {
        const buffer = holder.buffer;
        const column = this.#column(buffer.tableName as TableName, target.member, target.span);
        buffer.row ??= {};
        buffer.row[column] = toSqlValue(value);
        buffer.isEmpty = false;
        return;
      }
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

    if (object.type === "object") {
      return this.#readField(object.instance, expression.member, expression.span);
    }

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
    // Compile-time name functions take identifiers, so they are resolved before anything
    // is evaluated as a value.
    const compileTime = this.#compileTimeName(expression);
    if (compileTime !== undefined) return compileTime;

    const args: XppValue[] = [];
    for (const argument of expression.arguments) args.push(await this.#evaluate(argument));

    // `queryValue(x)` formats a value for a range. It is a plain conversion, but naming
    // it is what makes a range readable — and it is where enum-to-range conversion lives.
    if (
      expression.callee.kind === "identifier" &&
      expression.callee.name.toLowerCase() === "queryvalue"
    ) {
      return str(toDisplayString(args[0] ?? NULL));
    }

    // `super(...)` — the base class's version of the method we are currently in.
    if (expression.callee.kind === "identifier" && expression.callee.name === "super") {
      return this.#callSuper(undefined, args, expression.span);
    }

    // `ClassName::method(...)`. The parser sees `::` as enum access, because at parse time
    // `NoYes::Yes` and `MyClass::run()` are the same shape — only a call distinguishes them.
    if (expression.callee.kind === "enumAccess") {
      const runtime = this.#lookupClass(expression.callee.enumName);
      if (runtime !== undefined) {
        return this.#callStaticMethod(
          expression.callee.enumName,
          expression.callee.valueName,
          args,
          expression.span,
        );
      }
    }

    if (expression.callee.kind === "memberAccess") {
      // `super.method(...)`.
      if (
        expression.callee.object.kind === "identifier" &&
        expression.callee.object.name === "super"
      ) {
        return this.#callSuper(expression.callee.member, args, expression.span);
      }

      const receiver = await this.#evaluate(expression.callee.object);
      if (receiver.type === "object") {
        return this.#callInstanceMethod(
          receiver.instance,
          expression.callee.member,
          args,
          expression.span,
        );
      }
      if (receiver.type === "queryObject") {
        return this.#queryMethod(receiver.object, expression.callee.member, args, expression.span);
      }
      // Evaluated rather than looked up in scope, because a buffer is just as likely to be
      // a class field as a local — a data provider's temp table almost always is.
      if (receiver.type === "buffer") {
        return this.#bufferMethod(receiver.buffer, expression.callee.member, expression.span);
      }
    }

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
        return this.#validateWrite(buffer, span);

      case "validatedelete":
        // Delete validation is about DeleteActions — what a delete cascades to — and the
        // metadata model does not carry them. Returning `true` would say "safe to delete"
        // about a check nobody ran.
        throw new RuntimeError(
          XppErrorCodes.ConstructOutsideSubset,
          "validateDelete() is not available yet.",
          "It depends on delete actions between tables, which this environment does not model. validateWrite() does work.",
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

  /**
   * `buffer.validateWrite()` — the check a form runs before it saves.
   *
   * Three verified behaviours meet here:
   *
   *   VB-012  it returns a boolean. It reports; it does not write and does not throw.
   *   VB-013  nothing calls it for you from X++ code. `insert()` does not, which is
   *           exactly why lessons exist about it — this method is only ever reached
   *           because the learner typed it.
   *   VB-014  field checks run first and every failing field is reported.
   *
   * Failures go to the Infolog as errors, which is what `checkFailed` does in a real
   * table method, and then `false` comes back. Deciding what to do about `false` is the
   * caller's job — which is the entire point.
   */
  #validateWrite(buffer: TableBuffer, span: SourceSpan): XppValue {
    const table = this.#aot.getTable(buffer.tableName);
    if (table === undefined) {
      throw new RuntimeError(
        XppErrorCodes.MethodNotFound,
        `There is no metadata for ${buffer.tableName}, so it cannot be validated.`,
        "Only the tables in this environment's AOT can be validated.",
        "Error",
        span,
      );
    }

    const result = validateWrite({
      table,
      values: buffer.row ?? {},
      edtStringSizes: this.#edtStringSizes(),
    });

    for (const failure of result.failures) {
      this.infolog.add("error", failure.message, span.start.line);
    }

    return bool(result.ok);
  }

  /** String sizes by EDT name, so validateWrite can check a field against its type. */
  #edtStringSizes(): Record<string, number> {
    const sizes: Record<string, number> = {};
    for (const edt of this.#aot.getModel().edts) {
      if (edt.stringSize !== undefined) sizes[edt.name] = edt.stringSize;
    }
    return sizes;
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

  async #new(expression: Extract<Expression, { kind: "new" }>): Promise<XppValue> {
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

    if (name === "query") {
      return { type: "queryObject", object: { kind: "Query", query: createQuery() } };
    }

    if (name === "srsreportruncontroller") {
      return {
        type: "queryObject",
        object: { kind: "SrsReportRunController", controller: { reportName: "", ran: false } },
      };
    }

    if (name === "queryrun") {
      const source = await this.#evaluate(expression.arguments[0]!);
      if (source?.type !== "queryObject" || source.object.kind !== "Query") {
        throw new RuntimeError(
          XppErrorCodes.TypeMismatch,
          "`new QueryRun(...)` takes a Query.",
          "Build one with `Query query = new Query();` and pass that.",
          "Error",
          expression.span,
        );
      }
      return {
        type: "queryObject",
        object: {
          kind: "QueryRun",
          run: { query: source.object.query, cursor: 0, started: false },
        },
      };
    }

    const runtime = this.#lookupClass(expression.className);
    if (runtime !== undefined) {
      const args: XppValue[] = [];
      for (const argument of expression.arguments) args.push(await this.#evaluate(argument));
      return this.#construct(runtime, args, expression.span);
    }

    throw new RuntimeError(
      XppErrorCodes.ObjectNotFound,
      `There is no class called '${expression.className}'.`,
      `Declare it with \`class ${expression.className} { ... }\` in this file. \`List\`, \`Map\` and \`Set\` are built in.`,
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

/**
 * Widens or narrows a returned value to the method's declared type.
 *
 * Deliberately numeric-only. A `real` method that returns an int literal should hand back
 * a real, and an `int` method that returns a real should truncate — both are what a
 * statically typed language does. Everything else is left alone, because coercing a `str`
 * or a buffer here would be inventing conversions X++ does not perform silently.
 */
function coerceToDeclaredType(typeName: string, value: XppValue): XppValue {
  switch (typeName.toLowerCase()) {
    case "real":
      return value.type === "real" ? value : real(toNumber(value));
    case "int":
      return value.type === "int" ? value : int(toNumber(value));
    case "int64":
      return value.type === "int64" ? value : { type: "int64", value: Math.trunc(toNumber(value)) };
    default:
      return value;
  }
}
