/**
 * `select` → parameterised SQL.
 *
 * This module has a user-visible output. When a learner asks "why did my loop run 400
 * statements", the answer is the SQL this produced, shown in the trace panel. So it is
 * built and tested on its own, and it never inlines a parameter value.
 *
 * Company scoping is applied here, not by the caller: every company-scoped table gets a
 * `DATAAREAID = ?` predicate unless the select said `crosscompany`. Getting that wrong
 * silently would break the highest-value lesson on the site.
 */

import type { CompanyId, SqlValue, XppError } from "@xpplab/xpp-core";
import { XppErrorCodes, createError } from "@xpplab/xpp-core";
import type {
  Expression,
  SelectClauses,
  SelectField,
  SelectJoin,
  SelectSource,
} from "@xpplab/xpp-parser";
import { DATAAREAID_FIELD, RECID_FIELD, getTableSchema, type TableName } from "../schema.js";
import { getBaseEnum } from "../enums.js";

export interface SelectToSqlOptions {
  /** The active company, injected as a `DATAAREAID` predicate unless `crosscompany`. */
  company: CompanyId;
  /** Resolves a buffer variable name to the table it was declared as. */
  resolveBuffer: (name: string) => TableName | undefined;
}

export interface CompiledSelect {
  sql: string;
  parameters: SqlValue[];
  /** Buffer name → the columns it will be populated from, in `sql` column order. */
  outputs: Record<string, string[]>;
  /** `forupdate` was requested — the interpreter marks the buffer writable. */
  forUpdate: boolean;
  /** Buffer name → the SQL alias it was given. */
  aliases: Record<string, string>;
}

export type SelectCompilation = CompiledSelect | { errors: XppError[] };

export function isCompiled(result: SelectCompilation): result is CompiledSelect {
  return "sql" in result;
}

/** Everything one buffer contributes to the statement. */
interface Binding {
  buffer: string;
  table: TableName;
  alias: string;
  /** `undefined` means every column. */
  columns?: string[];
}

class CompileError extends Error {
  constructor(readonly error: XppError) {
    super(error.message);
  }
}

export function selectToSql(
  clauses: SelectClauses,
  options: SelectToSqlOptions,
): SelectCompilation {
  try {
    return new SelectCompiler(clauses, options).compile();
  } catch (error) {
    if (error instanceof CompileError) return { errors: [error.error] };
    throw error;
  }
}

class SelectCompiler {
  readonly #clauses: SelectClauses;
  readonly #options: SelectToSqlOptions;
  readonly #parameters: SqlValue[] = [];
  readonly #bindings = new Map<string, Binding>();

  constructor(clauses: SelectClauses, options: SelectToSqlOptions) {
    this.#clauses = clauses;
    this.#options = options;
  }

  compile(): CompiledSelect {
    const root = this.#bind(this.#clauses.source);
    const joins = this.#clauses.source.joins.map((join) => this.#bindJoin(join));

    const columns = this.#selectList();
    const from = this.#fromClause(root, joins);
    const where = this.#whereClause(joins);
    const orderBy = this.#orderByClause();
    const limit = this.#limitClause();

    const sql = [
      `SELECT ${columns}`,
      `FROM ${from}`,
      where === undefined ? undefined : `WHERE ${where}`,
      orderBy,
      limit,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" ");

    const outputs: Record<string, string[]> = {};
    const aliases: Record<string, string> = {};
    for (const binding of this.#bindings.values()) {
      // `exists`/`notexists` joins contribute no columns — that is the whole point of
      // them, and it is why they are cheaper than a real join.
      if (binding.columns !== undefined && binding.columns.length === 0) continue;
      outputs[binding.buffer] = binding.columns ?? this.#allColumns(binding.table);
      aliases[binding.buffer] = binding.alias;
    }

    return {
      sql,
      parameters: this.#parameters,
      outputs,
      aliases,
      forUpdate: this.#clauses.modifiers.includes("forupdate"),
    };
  }

  // -- bindings ------------------------------------------------------------

  #bind(source: SelectSource, columns?: string[]): Binding {
    const table = this.#options.resolveBuffer(source.buffer);
    if (table === undefined) {
      throw new CompileError(
        createError(
          XppErrorCodes.UndeclaredIdentifier,
          `'${source.buffer}' has not been declared as a table buffer.`,
          source.span,
          `Declare it first — for example \`CustTable ${source.buffer};\` — then select into it.`,
        ),
      );
    }

    const alias = `t${this.#bindings.size}`;
    const resolved = this.#resolveColumns(source, table, columns);
    const binding: Binding = {
      buffer: source.buffer,
      table,
      alias,
      ...(resolved === undefined ? {} : { columns: resolved }),
    };
    this.#bindings.set(source.buffer, binding);
    return binding;
  }

  #bindJoin(join: SelectJoin): { join: SelectJoin; binding: Binding } {
    // exists/notexists produce no output columns; they become EXISTS subqueries below.
    const columns = join.joinKind === "exists" || join.joinKind === "notexists" ? [] : undefined;
    return { join, binding: this.#bind(join.source, columns) };
  }

  #resolveColumns(
    source: SelectSource,
    table: TableName,
    override?: string[],
  ): string[] | undefined {
    if (override !== undefined) return override;
    const fieldList = source.fieldList;
    if (fieldList === undefined || fieldList.all) return undefined;
    return fieldList.fields.map((field) => this.#resolveField(field, table));
  }

  #resolveField(field: SelectField, table: TableName): string {
    const schema = getTableSchema(table)!;
    const known = [...schema.fields.map((f) => f.name), RECID_FIELD, DATAAREAID_FIELD];
    const match = known.find((name) => name.toLowerCase() === field.name.toLowerCase());
    if (match === undefined) {
      throw new CompileError(
        createError(
          XppErrorCodes.FieldNotFound,
          `${table} has no field named '${field.name}'.`,
          field.span,
          `Fields on ${table}: ${known.slice(0, 8).join(", ")}${known.length > 8 ? ", …" : ""}.`,
        ),
      );
    }
    return match;
  }

  #allColumns(table: TableName): string[] {
    const schema = getTableSchema(table)!;
    return [...schema.fields.map((field) => field.name), RECID_FIELD, DATAAREAID_FIELD];
  }

  // -- clauses -------------------------------------------------------------

  #selectList(): string {
    const parts: string[] = [];

    for (const binding of this.#bindings.values()) {
      if (binding.columns !== undefined && binding.columns.length === 0) continue;

      const source = this.#sourceFor(binding.buffer);
      const aggregates = source?.fieldList?.fields.filter((field) => field.aggregate) ?? [];

      if (aggregates.length > 0) {
        for (const field of aggregates) {
          const column = this.#resolveField(field, binding.table);
          parts.push(
            `${sqlAggregate(field.aggregate!)}(${binding.alias}.${column}) AS ${binding.alias}_${column}`,
          );
        }
        continue;
      }

      for (const column of binding.columns ?? this.#allColumns(binding.table)) {
        parts.push(`${binding.alias}.${column}`);
      }
    }

    return parts.join(", ");
  }

  #sourceFor(buffer: string): SelectSource | undefined {
    if (this.#clauses.source.buffer === buffer) return this.#clauses.source;
    return this.#clauses.source.joins.find((join) => join.source.buffer === buffer)?.source;
  }

  #fromClause(root: Binding, joins: { join: SelectJoin; binding: Binding }[]): string {
    let sql = `${root.table} AS ${root.alias}`;

    for (const { join, binding } of joins) {
      if (join.joinKind === "exists" || join.joinKind === "notexists") continue;
      const keyword = join.joinKind === "outer" ? "LEFT OUTER JOIN" : "INNER JOIN";
      const on = this.#joinPredicate(join, binding);
      sql += ` ${keyword} ${binding.table} AS ${binding.alias} ON ${on}`;
    }

    return sql;
  }

  #joinPredicate(join: SelectJoin, binding: Binding): string {
    const parts: string[] = [];
    if (join.on !== undefined) parts.push(this.#expression(join.on));
    const scope = this.#companyPredicate(binding);
    if (scope !== undefined) parts.push(scope);
    return parts.length === 0 ? "1 = 1" : parts.join(" AND ");
  }

  #whereClause(joins: { join: SelectJoin; binding: Binding }[]): string | undefined {
    const parts: string[] = [];

    if (this.#clauses.where !== undefined) parts.push(this.#expression(this.#clauses.where));

    const rootBinding = this.#bindings.get(this.#clauses.source.buffer)!;
    const rootScope = this.#companyPredicate(rootBinding);
    if (rootScope !== undefined) parts.push(rootScope);

    // exists/notexists become correlated subqueries rather than joins, which is exactly
    // how F&O compiles them and why they cannot duplicate outer rows.
    for (const { join, binding } of joins) {
      if (join.joinKind !== "exists" && join.joinKind !== "notexists") continue;

      const inner: string[] = [];
      if (join.on !== undefined) inner.push(this.#expression(join.on));
      const scope = this.#companyPredicate(binding);
      if (scope !== undefined) inner.push(scope);

      const negation = join.joinKind === "notexists" ? "NOT " : "";
      const predicate = inner.length === 0 ? "1 = 1" : inner.join(" AND ");
      parts.push(
        `${negation}EXISTS (SELECT 1 FROM ${binding.table} AS ${binding.alias} WHERE ${predicate})`,
      );
    }

    return parts.length === 0 ? undefined : parts.join(" AND ");
  }

  /**
   * The `DATAAREAID = ?` predicate. Omitted for shared tables, which have no company,
   * and for `crosscompany`, which is what the modifier means.
   */
  #companyPredicate(binding: Binding): string | undefined {
    if (this.#clauses.modifiers.includes("crosscompany")) return undefined;
    const schema = getTableSchema(binding.table)!;
    if (!schema.saveDataPerCompany) return undefined;
    this.#parameters.push(this.#options.company);
    return `${binding.alias}.${DATAAREAID_FIELD} = ?`;
  }

  #orderByClause(): string | undefined {
    const orderBy = this.#clauses.orderBy;
    if (orderBy === undefined) return undefined;

    const rootBinding = this.#bindings.get(this.#clauses.source.buffer)!;
    const entries = orderBy.entries.map((entry) => {
      const column = this.#resolveField(
        { kind: "selectField", name: entry.field, span: entry.span },
        rootBinding.table,
      );
      return `${rootBinding.alias}.${column}${entry.direction === "desc" ? " DESC" : " ASC"}`;
    });

    // `group by` and `order by` share a shape in the AST but not in SQL.
    if (orderBy.grouping) {
      const columns = entries.map((entry) => entry.replace(/ (ASC|DESC)$/, ""));
      return `GROUP BY ${columns.join(", ")}`;
    }

    // `reverse` flips the requested order rather than adding a second sort.
    if (this.#clauses.modifiers.includes("reverse")) {
      return `ORDER BY ${entries.map(flipDirection).join(", ")}`;
    }

    return `ORDER BY ${entries.join(", ")}`;
  }

  #limitClause(): string | undefined {
    const limit = firstOnlyLimit(this.#clauses.modifiers);
    return limit === undefined ? undefined : `LIMIT ${limit}`;
  }

  // -- expressions ---------------------------------------------------------

  /**
   * Compiles a `where` expression to SQL.
   *
   * Only the operators that have a faithful SQL equivalent are allowed. Anything else —
   * a method call, a container, arithmetic on a buffer field — is rejected with a hint
   * rather than approximated, because a `where` that quietly means something different
   * from what it says is the worst possible outcome here.
   */
  #expression(expression: Expression): string {
    switch (expression.kind) {
      case "binary":
        return this.#binary(expression);

      case "unary": {
        if (expression.operator === "!" || expression.operator === "not") {
          return `NOT (${this.#expression(expression.argument)})`;
        }
        if (expression.operator === "-") {
          return `-(${this.#expression(expression.argument)})`;
        }
        break;
      }

      case "memberAccess": {
        // `custTable.AccountNum` — the only shape a field reference takes in a where.
        if (expression.object.kind === "identifier") {
          const binding = this.#bindings.get(expression.object.name);
          if (binding !== undefined) {
            const column = this.#resolveField(
              { kind: "selectField", name: expression.member, span: expression.span },
              binding.table,
            );
            return `${binding.alias}.${column}`;
          }
        }
        break;
      }

      case "literal": {
        this.#parameters.push(literalValue(expression.value));
        return "?";
      }

      case "enumAccess": {
        // Enum values reach SQL as their integer, which is how they are stored.
        this.#parameters.push(enumOrdinal(expression.enumName, expression.valueName, expression));
        return "?";
      }

      case "identifier":
        // A bare identifier in a where is a host variable. The interpreter substitutes
        // its value before compiling, so reaching here means it was never bound.
        throw new CompileError(
          createError(
            XppErrorCodes.UndeclaredIdentifier,
            `'${expression.name}' is not a declared variable or a field of a selected buffer.`,
            expression.span,
            "In a `where` clause, name a field as `buffer.Field`, or use a variable that is in scope.",
          ),
        );

      default:
        break;
    }

    throw new CompileError(
      createError(
        XppErrorCodes.ConstructOutsideSubset,
        "This expression cannot be used in a `where` clause.",
        expression.span,
        "A `where` becomes SQL, so it can only compare fields, variables and literals. Compute the value before the select and compare against that.",
      ),
    );
  }

  #binary(expression: Extract<Expression, { kind: "binary" }>): string {
    const operator = SQL_OPERATORS[expression.operator];
    if (operator === undefined) {
      throw new CompileError(
        createError(
          XppErrorCodes.ConstructOutsideSubset,
          `The '${expression.operator}' operator cannot be used in a \`where\` clause.`,
          expression.span,
          "A `where` becomes SQL. Compute this before the select and compare against the result.",
        ),
      );
    }

    const left = this.#expression(expression.left);
    const right = this.#expression(expression.right);

    // X++ `like` uses * and ?; SQL LIKE uses % and _. Translate the pattern rather than
    // passing it through, or every wildcard silently matches nothing.
    if (expression.operator === "like") {
      const last = this.#parameters.length - 1;
      const pattern = this.#parameters[last];
      if (typeof pattern === "string") {
        this.#parameters[last] = pattern
          .replace(/%/g, "\\%")
          .replace(/\*/g, "%")
          .replace(/\?/g, "_");
      }
    }

    return `(${left} ${operator} ${right})`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SQL_OPERATORS: Partial<Record<string, string>> = {
  "==": "=",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "&&": "AND",
  "||": "OR",
  like: "LIKE",
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
};

function sqlAggregate(aggregate: string): string {
  switch (aggregate) {
    case "maxof":
      return "MAX";
    case "minof":
      return "MIN";
    case "avg":
      return "AVG";
    case "count":
      return "COUNT";
    default:
      return "SUM";
  }
}

function firstOnlyLimit(modifiers: readonly string[]): number | undefined {
  if (modifiers.includes("firstonly1000")) return 1000;
  if (modifiers.includes("firstonly100")) return 100;
  if (modifiers.includes("firstonly10")) return 10;
  if (modifiers.includes("firstonly")) return 1;
  return undefined;
}

function flipDirection(entry: string): string {
  return entry.endsWith(" DESC")
    ? entry.replace(/ DESC$/, " ASC")
    : entry.replace(/ ASC$/, " DESC");
}

function literalValue(value: string | number | boolean | null): SqlValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/** Resolves `NoYes::Yes` to the integer it is stored as. */
function enumOrdinal(enumName: string, valueName: string, expression: Expression): number {
  const found = getBaseEnum(enumName)?.values.find(
    (value) => value.name.toLowerCase() === valueName.toLowerCase(),
  );
  if (found === undefined) {
    throw new CompileError(
      createError(
        XppErrorCodes.FieldNotFound,
        `${enumName}::${valueName} is not a value of any known enum.`,
        expression.span,
        "Check the spelling, or the enum name — the AOT explorer lists every base enum and its values.",
      ),
    );
  }
  return found.value;
}
