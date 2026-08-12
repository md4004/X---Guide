/**
 * The Query object model — a `select` you assemble at runtime instead of writing out.
 *
 * This is where forms, reports and views get their data, and Microsoft's own guidance is
 * to prefer a query object over naming a table directly. It is an explicit extension to
 * the v1 subset; the reasoning is recorded in docs/language-subset.md, and the API shape
 * is VB-051.
 *
 * The important design decision is that **nothing here generates SQL**. A query is
 * compiled into exactly the same `SelectClauses` node the parser produces for a
 * hand-written `select`, and handed to the same `selectToSql`. Two consequences, both of
 * which are the point:
 *
 *   - The SQL trace for a query object is indistinguishable from the trace for the
 *     equivalent `while select`, so a learner can see that they really are the same thing.
 *   - Company scoping, parameter binding and field resolution cannot drift, because there
 *     is only one implementation of them.
 */

import type { SourceSpan, SqlValue } from "@xpplab/xpp-core";
import type { Expression, OrderByEntry, SelectClauses } from "@xpplab/xpp-parser";

/** A `QueryBuildRange` — one field, one value expression in the documented range syntax. */
export interface QueryRange {
  field: string;
  value: string;
}

/** A `QueryBuildDataSource`. One table, its ranges and its sort order. */
export interface QueryDataSource {
  table: string;
  /** The buffer name the compiled select reads into. Derived from the table name. */
  buffer: string;
  ranges: QueryRange[];
  sortFields: { field: string; direction: "asc" | "desc" }[];
}

export interface QueryModel {
  dataSources: QueryDataSource[];
}

/** A `QueryRun` mid-walk: the rows it fetched and where the cursor is. */
export interface QueryRunState {
  query: QueryModel;
  /** `undefined` until the first `next()` runs the query — a QueryRun is lazy. */
  rows?: SqlValue[][];
  /** The output column names, in `rows` order, so `get()` can rebuild a buffer row. */
  columns?: string[];
  cursor: number;
  started: boolean;
}

export function createQuery(): QueryModel {
  return { dataSources: [] };
}

export function addDataSource(query: QueryModel, table: string): QueryDataSource {
  const dataSource: QueryDataSource = {
    table,
    // `inventTable` from `InventTable` — the same name a developer would have given the
    // buffer, so the compiled SQL reads the way the hand-written version would.
    buffer: table.charAt(0).toLowerCase() + table.slice(1),
    ranges: [],
    sortFields: [],
  };
  query.dataSources.push(dataSource);
  return dataSource;
}

/** `dataSourceTable(tableNum(X))` — finds a data source that is already on the query. */
export function findDataSource(query: QueryModel, table: string): QueryDataSource | undefined {
  return query.dataSources.find(
    (dataSource) => dataSource.table.toLowerCase() === table.toLowerCase(),
  );
}

export function findRange(dataSource: QueryDataSource, field: string): QueryRange | undefined {
  return dataSource.ranges.find((range) => range.field.toLowerCase() === field.toLowerCase());
}

export function addRange(dataSource: QueryDataSource, field: string): QueryRange {
  const range: QueryRange = { field, value: "" };
  dataSource.ranges.push(range);
  return range;
}

// ---------------------------------------------------------------------------
// Range values
// ---------------------------------------------------------------------------

/**
 * The comparison a range value asks for.
 *
 * A range is not always equality. The documented advanced syntax covers `>2`, `<=10`,
 * `A..M` for an inclusive interval, and `*` as a wildcard — and a developer who thinks a
 * range means `==` writes filters that quietly match nothing.
 */
export type RangeComparison =
  | { kind: "equals"; value: string }
  | { kind: "compare"; operator: "<" | "<=" | ">" | ">="; value: string }
  | { kind: "between"; from: string; to: string }
  | { kind: "like"; pattern: string }
  | { kind: "empty" };

export function parseRangeValue(raw: string): RangeComparison {
  const value = raw.trim();
  if (value === "") return { kind: "empty" };

  for (const operator of [">=", "<=", ">", "<"] as const) {
    if (value.startsWith(operator)) {
      return { kind: "compare", operator, value: value.slice(operator.length).trim() };
    }
  }

  // `A..M`. Checked before the wildcard so a range of ids containing dots still works.
  const interval = value.split("..");
  if (interval.length === 2 && interval[0] !== "" && interval[1] !== "") {
    return { kind: "between", from: interval[0]!.trim(), to: interval[1]!.trim() };
  }

  if (value.includes("*") || value.includes("?")) return { kind: "like", pattern: value };

  return { kind: "equals", value };
}

// ---------------------------------------------------------------------------
// Compiling to the parser's own shape
// ---------------------------------------------------------------------------

/** Queries are built at runtime, so their nodes have no real source position. */
const SYNTHETIC: SourceSpan = {
  start: { line: 0, column: 0, offset: 0 },
  end: { line: 0, column: 0, offset: 0 },
};

const literal = (value: string): Expression => {
  // A range value arrives as text even when the field is numeric — `qbr.value("2")` — so
  // the literal is typed by what it looks like, which is what the real framework does
  // when it parses a range string against the field's type.
  const asNumber = Number(value);
  const numeric = value !== "" && Number.isFinite(asNumber);

  return {
    kind: "literal",
    literalType: numeric ? (Number.isInteger(asNumber) ? "int" : "real") : "str",
    value: numeric ? asNumber : value,
    span: SYNTHETIC,
  } as Expression;
};

const field = (buffer: string, name: string): Expression =>
  ({
    kind: "memberAccess",
    object: { kind: "identifier", name: buffer, span: SYNTHETIC },
    member: name,
    span: SYNTHETIC,
  }) as Expression;

const binary = (operator: string, left: Expression, right: Expression): Expression =>
  ({ kind: "binary", operator, left, right, span: SYNTHETIC }) as Expression;

const and = (left: Expression | undefined, right: Expression): Expression =>
  left === undefined ? right : binary("&&", left, right);

/** One range as a `where` fragment. */
function rangeToExpression(buffer: string, range: QueryRange): Expression | undefined {
  const comparison = parseRangeValue(range.value);
  const target = field(buffer, range.field);

  switch (comparison.kind) {
    // A range with no value filters nothing. That is the framework's behaviour and it is
    // worth knowing: an unset range is not "match nothing", it is "no restriction".
    case "empty":
      return undefined;
    case "equals":
      return binary("==", target, literal(comparison.value));
    case "compare":
      return binary(comparison.operator, target, literal(comparison.value));
    case "like":
      return binary("like", target, literal(comparison.pattern));
    case "between":
      return binary(
        "&&",
        binary(">=", target, literal(comparison.from)),
        binary("<=", target, literal(comparison.to)),
      );
  }
}

export class QueryCompileError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/**
 * Compiles a query into the clause bundle `selectToSql` already understands.
 *
 * Only the first data source is compiled. Joins between query data sources are out of
 * this extension's scope — see docs/language-subset.md — and asking for one is refused
 * rather than silently dropped, because a query that quietly ignores half of itself is
 * the worst possible outcome for a learner.
 */
export function queryToSelectClauses(query: QueryModel): SelectClauses {
  const [primary, ...rest] = query.dataSources;

  if (primary === undefined) {
    throw new QueryCompileError(
      "This query has no data source, so there is nothing to run.",
      "Call `query.addDataSource(tableNum(YourTable))` before running it.",
    );
  }

  if (rest.length > 0) {
    throw new QueryCompileError(
      "This query has more than one data source, and joined query data sources are not simulated.",
      "Write the join as a `while select ... join ...` instead. The Query object model here covers one data source with ranges and sorting; the joined form is out of scope and is explained in prose.",
    );
  }

  let where: Expression | undefined;
  for (const range of primary.ranges) {
    const expression = rangeToExpression(primary.buffer, range);
    if (expression !== undefined) where = and(where, expression);
  }

  const entries: OrderByEntry[] = primary.sortFields.map((sort) => ({
    kind: "orderByEntry",
    field: sort.field,
    direction: sort.direction,
    span: SYNTHETIC,
  }));

  return {
    kind: "selectClauses",
    modifiers: [],
    source: {
      kind: "selectSource",
      buffer: primary.buffer,
      joins: [],
      span: SYNTHETIC,
    },
    ...(where === undefined ? {} : { where }),
    ...(entries.length === 0
      ? {}
      : { orderBy: { kind: "orderBy", entries, grouping: false, span: SYNTHETIC } }),
    span: SYNTHETIC,
  };
}
