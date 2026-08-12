/**
 * The OData endpoint, over the virtual database.
 *
 * Two things make this worth simulating rather than describing.
 *
 * The first is that every response comes back paired with **the SQL it generated**. An
 * OData URL is a query written in someone else's syntax, and the fastest way to stop
 * treating it as magic is to see `$filter=CustomerGroupId eq 'RETAIL'` turn into a `WHERE`
 * with a bound parameter.
 *
 * The second is cross-company (VB-058). A request returns the default company's data and
 * nothing else unless it says otherwise — the same trap as `crosscompany` in X++, one
 * layer out, and the one that produces "the integration is missing rows" tickets.
 *
 * What is *not* here: batch requests, `$expand` beyond the entity's own joins, actions,
 * and the `$metadata` document. Those are named in the lesson and refused here.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { DataEntityMetadata } from "@xpplab/virtual-aot";
import { DATAAREAID_FIELD, type TableName, type VirtualDb } from "@xpplab/virtual-db";

export interface ODataRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Entity public collection name, e.g. `CustomersV3`. */
  entity: string;
  key?: Record<string, SqlValue>;
  query?: {
    select?: string[];
    filter?: string;
    top?: number;
    skip?: number;
    expand?: string[];
    orderby?: string[];
    count?: boolean;
    /** VB-058. Absent or `false` means the default company only. */
    crossCompany?: boolean;
  };
  body?: Record<string, SqlValue>;
}

export interface ODataResponse {
  status: number;
  body: unknown;
  /** The SQL the request generated. Shown beside the JSON — that pairing is the lesson. */
  sql: { statement: string; parameters: SqlValue[] }[];
  error?: { code: string; message: string };
}

export interface ODataContext {
  entities: readonly DataEntityMetadata[];
  db: VirtualDb;
}

/** The documented maximum server-driven page size (VB-056). */
export const MAX_PAGE_SIZE = 10_000;

// ---------------------------------------------------------------------------
// $filter
// ---------------------------------------------------------------------------

type FilterNode =
  | { kind: "compare"; field: string; operator: string; value: SqlValue }
  | { kind: "contains"; field: string; pattern: string }
  | { kind: "and" | "or"; left: FilterNode; right: FilterNode }
  | { kind: "not"; operand: FilterNode };

export class ODataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** `eq` and friends, mapped to SQL. `has` and `in` are documented as unsupported. */
const OPERATORS: Record<string, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

function tokenizeFilter(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "(" || character === ")") {
      tokens.push(character);
      index += 1;
      continue;
    }

    // A quoted literal, with '' as the escape for a single quote.
    if (character === "'") {
      let literal = "'";
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          literal += "'";
          index += 2;
          continue;
        }
        if (source[index] === "'") {
          index += 1;
          break;
        }
        literal += source[index];
        index += 1;
      }
      tokens.push(`${literal}'`);
      continue;
    }

    let word = "";
    while (index < source.length && !/[\s()]/.test(source[index]!)) {
      word += source[index];
      index += 1;
    }
    tokens.push(word);
  }

  return tokens;
}

/**
 * A recursive-descent parser for the subset of `$filter` the endpoint supports.
 *
 * Small on purpose. The value is not in covering the whole grammar — it is in rejecting
 * `has` and `in` by name (VB-057), because the OData spec has them and F&O does not, and
 * a developer who does not know that loses an afternoon to a filter that returns 400.
 */
function parseFilter(source: string): FilterNode {
  const tokens = tokenizeFilter(source);
  let position = 0;

  const peek = (): string | undefined => tokens[position];
  const take = (): string => {
    const token = tokens[position];
    if (token === undefined) {
      throw new ODataError("BadRequest", "The $filter expression ended unexpectedly.");
    }
    position += 1;
    return token;
  };

  const parseValue = (raw: string): SqlValue => {
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
    if (raw === "true") return 1;
    if (raw === "false") return 0;
    if (raw === "null") return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;
    // An enum in a filter arrives fully qualified, e.g.
    // Microsoft.Dynamics.DataEntities.NoYes'Yes'. The value is what is inside the quotes.
    const enumMatch = /^[\w.]+'(.*)'$/.exec(raw);
    if (enumMatch !== null) return enumMatch[1]!;
    throw new ODataError("BadRequest", `'${raw}' is not a value $filter understands.`);
  };

  const parsePrimary = (): FilterNode => {
    if (peek() === "(") {
      take();
      const inner = parseOr();
      if (take() !== ")") {
        throw new ODataError("BadRequest", "A '(' in the $filter has no matching ')'.");
      }
      return inner;
    }

    if (peek() === "not") {
      take();
      return { kind: "not", operand: parsePrimary() };
    }

    const field = take();

    // `contains(Field,'text')` arrives as one token because there is no whitespace.
    const contains = /^contains\((\w+),'(.*)'\)$/.exec(field);
    if (contains !== null) {
      return { kind: "contains", field: contains[1]!, pattern: contains[2]! };
    }

    const operator = take();

    if (operator === "has" || operator === "in") {
      throw new ODataError(
        "BadRequest",
        `The '${operator}' operator is not supported. It is part of the OData specification, but this endpoint does not implement it — rewrite the filter with 'eq' and 'or'.`,
      );
    }

    const sqlOperator = OPERATORS[operator];
    if (sqlOperator === undefined) {
      throw new ODataError(
        "BadRequest",
        `'${operator}' is not a $filter operator. Use eq, ne, gt, ge, lt or le.`,
      );
    }

    const value = parseValue(take());

    // The documented wildcard form: `Field eq '*retail*'` means contains.
    if (typeof value === "string" && value.includes("*") && sqlOperator === "=") {
      return { kind: "contains", field, pattern: value };
    }

    return { kind: "compare", field, operator: sqlOperator, value };
  };

  const parseAnd = (): FilterNode => {
    let left = parsePrimary();
    while (peek() === "and") {
      take();
      left = { kind: "and", left, right: parsePrimary() };
    }
    return left;
  };

  function parseOr(): FilterNode {
    let left = parseAnd();
    while (peek() === "or") {
      take();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  }

  const node = parseOr();
  if (position < tokens.length) {
    throw new ODataError("BadRequest", `Unexpected '${tokens[position]}' in the $filter.`);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Compiling a request
// ---------------------------------------------------------------------------

/** Resolves an entity property to the `Table.Field` behind it. */
function columnFor(entity: DataEntityMetadata, property: string): string {
  const mapped = Object.entries(entity.mappings).find(
    ([name]) => name.toLowerCase() === property.toLowerCase(),
  );

  if (mapped === undefined) {
    // `dataAreaId` is not a mapped property — it is the company column, and filtering on
    // it is the documented way to target one company (VB-058).
    if (property.toLowerCase() === "dataareaid")
      return `${entity.primaryTable}.${DATAAREAID_FIELD}`;

    throw new ODataError(
      "BadRequest",
      `'${property}' is not a property of ${entity.publicCollectionName}. Properties are ${Object.keys(entity.mappings).join(", ")}.`,
    );
  }

  return mapped[1];
}

function filterToSql(node: FilterNode, entity: DataEntityMetadata, parameters: SqlValue[]): string {
  switch (node.kind) {
    case "and":
    case "or":
      return `(${filterToSql(node.left, entity, parameters)} ${node.kind.toUpperCase()} ${filterToSql(node.right, entity, parameters)})`;
    case "not":
      return `NOT (${filterToSql(node.operand, entity, parameters)})`;
    case "contains":
      parameters.push(`%${node.pattern.replace(/\*/g, "")}%`);
      return `${columnFor(entity, node.field)} LIKE ?`;
    case "compare":
      parameters.push(node.value);
      return `${columnFor(entity, node.field)} ${node.operator} ?`;
  }
}

/**
 * Serves a request.
 *
 * Reads only. A write would have to run the entity's validation chain — `clear`,
 * `initValue`, `validateField`, `defaultRow`, `validateWrite`, `write` (VB-059) — and
 * this simulator implements two of those six. Pretending to run the rest would teach that
 * an OData insert and an X++ `insert()` validate the same way, which is exactly the thing
 * VB-013 exists to correct.
 */
export async function handleODataRequest(
  request: ODataRequest,
  context: ODataContext,
): Promise<ODataResponse> {
  const sql: { statement: string; parameters: SqlValue[] }[] = [];

  try {
    if (request.method !== "GET") {
      throw new ODataError(
        "NotImplemented",
        `${request.method} is not simulated. A write through OData runs the entity's whole validation chain — clear, initValue, validateField, defaultRow, validateWrite, write — and this engine implements only part of it. Running a partial chain would teach that an OData write and an X++ insert() validate alike, which is the opposite of the truth.`,
        501,
      );
    }

    const entity = context.entities.find(
      (candidate) => candidate.publicCollectionName.toLowerCase() === request.entity.toLowerCase(),
    );

    if (entity === undefined) {
      throw new ODataError(
        "ResourceNotFound",
        `There is no entity collection called '${request.entity}'.`,
        404,
      );
    }

    // VB-055. The entity exists in the AOT; it is simply not on the endpoint, and saying
    // so precisely is the difference between a five-minute fix and an afternoon.
    if (!entity.isPublic) {
      throw new ODataError(
        "ResourceNotFound",
        `'${entity.publicCollectionName}' exists, but its Enable public API property is false, so it is not exposed to OData. Data management can still see it.`,
        404,
      );
    }

    const query = request.query ?? {};
    const properties =
      query.select === undefined || query.select.length === 0
        ? Object.keys(entity.mappings)
        : query.select;

    const columns = properties.map((property) => `${columnFor(entity, property)} AS "${property}"`);

    const parameters: SqlValue[] = [];
    const wheres: string[] = [];

    if (query.filter !== undefined && query.filter.trim() !== "") {
      wheres.push(filterToSql(parseFilter(query.filter), entity, parameters));
    }

    if (request.key !== undefined) {
      for (const [property, value] of Object.entries(request.key)) {
        wheres.push(`${columnFor(entity, property)} = ?`);
        parameters.push(value);
      }
    }

    // VB-058: the default company only, unless the request asked for more.
    if (query.crossCompany !== true) {
      wheres.push(`${entity.primaryTable}.${DATAAREAID_FIELD} = ?`);
      parameters.push(context.db.getCompany());
    }

    const joins = entity.joins
      .map(
        (join) =>
          `LEFT JOIN ${join.table} ON ${join.table}.${join.toField} = ${entity.primaryTable}.${join.fromField}`,
      )
      .join(" ");

    const orderBy =
      query.orderby === undefined || query.orderby.length === 0
        ? ""
        : ` ORDER BY ${query.orderby
            .map((entry) => {
              const [property, direction] = entry.trim().split(/\s+/);
              const column = columnFor(entity, property ?? "");
              return `${column}${direction?.toLowerCase() === "desc" ? " DESC" : " ASC"}`;
            })
            .join(", ")}`;

    // VB-056: paging is server-driven and capped, so an unbounded $top is not unbounded.
    const top = Math.min(query.top ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const limit = ` LIMIT ${top}${query.skip === undefined ? "" : ` OFFSET ${query.skip}`}`;

    const statement =
      `SELECT ${columns.join(", ")} FROM ${entity.primaryTable}` +
      (joins === "" ? "" : ` ${joins}`) +
      (wheres.length === 0 ? "" : ` WHERE ${wheres.join(" AND ")}`) +
      orderBy +
      limit;

    sql.push({ statement, parameters: [...parameters] });
    const result = await context.db.exec(statement, parameters);

    const rows = result.rows.map((row) => {
      const record: Record<string, SqlValue> = {};
      for (const [index, property] of properties.entries()) record[property] = row[index] ?? null;
      return record;
    });

    return {
      status: 200,
      sql,
      body: {
        "@odata.context": `$metadata#${entity.publicCollectionName}`,
        ...(query.count === true ? { "@odata.count": rows.length } : {}),
        value: rows,
      },
    };
  } catch (error) {
    if (error instanceof ODataError) {
      return {
        status: error.status,
        sql,
        body: { error: { code: error.code, message: error.message } },
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

/** The collections a client would see at the service root — public entities only. */
export function listPublicCollections(entities: readonly DataEntityMetadata[]): string[] {
  return entities
    .filter((entity) => entity.isPublic)
    .map((entity) => entity.publicCollectionName)
    .sort((left, right) => left.localeCompare(right));
}

export type { TableName };
