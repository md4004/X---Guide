/**
 * Runtime values, and the conversions between them.
 *
 * X++ is more willing to convert than TypeScript is, and the places where it is *not*
 * willing are lessons in themselves. Everything here is explicit for that reason: there
 * is no generic `toJs`, because "what does this become" depends on what it is becoming.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { QueryDataSource, QueryModel, QueryRange, QueryRunState } from "./query";
import type { Row } from "@xpplab/virtual-db";

export type XppValue =
  | { type: "void" }
  | { type: "int"; value: number }
  | { type: "int64"; value: number }
  | { type: "real"; value: number }
  | { type: "str"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "utcdatetime"; value: string }
  | { type: "guid"; value: string }
  | { type: "enum"; enumName: string; valueName: string; value: number }
  | { type: "container"; elements: XppValue[] }
  | { type: "null" }
  | { type: "buffer"; buffer: TableBuffer }
  | { type: "object"; instance: ObjectInstance }
  | { type: "collection"; collection: XppCollection }
  /**
   * A query-framework object. Native rather than an `ObjectInstance` because its methods
   * do real work — building a select and running it — instead of executing X++ bodies.
   */
  | { type: "queryObject"; object: QueryObject };

/**
 * A table buffer — a first-class value, not a row object.
 *
 * `selectedForUpdate` exists because the forUpdate check is real (VB-003): writing
 * through a buffer that was not selected for update must fail the way F&O fails.
 * `transactionDepth` exists because the ttsLevel check is real too (VB-004): a record
 * may only be updated in the transaction scope it was selected in.
 */
export interface TableBuffer {
  tableName: string;
  row?: Row;
  selectedForUpdate: boolean;
  /** `RecId == 0` means "not found", and lessons test exactly that. */
  isEmpty: boolean;
  /** The company the row was read from, which `crosscompany` makes visible. */
  company?: string;
  /**
   * Identity of the transaction scope the row was selected for update in.
   *
   * An id rather than a depth, because two sibling transactions are both at depth 1 and
   * the ttsLevel check (VB-004) has to tell them apart.
   */
  selectedInScope?: number;
}

export interface ObjectInstance {
  className: string;
  fields: Map<string, XppValue>;
}

/**
 * The four query-framework types, tagged so method dispatch can tell them apart.
 *
 * They hold references into one shared `QueryModel`, exactly as the real classes do: a
 * `QueryBuildDataSource` handed back by `addDataSource` is a live handle, so adding a
 * range to it changes the query it came from.
 */
export type QueryObject =
  | { kind: "Query"; query: QueryModel }
  | { kind: "QueryBuildDataSource"; dataSource: QueryDataSource }
  | { kind: "QueryBuildRange"; range: QueryRange }
  | { kind: "QueryRun"; run: QueryRunState }
  /**
   * The report controller. Native because `startOperation()` *is* the framework: it
   * resolves the report from metadata and drives the provider in an order the caller does
   * not choose. Written as an X++ stub it would have to invent a way to be handed the
   * provider, and that would teach a sequence that does not exist.
   */
  | { kind: "SrsReportRunController"; controller: { reportName: string; ran: boolean } };

export type XppCollection =
  | { kind: "List"; itemType: string; items: XppValue[] }
  | { kind: "Set"; itemType: string; items: XppValue[] }
  | { kind: "Map"; keyType: string; valueType: string; entries: [XppValue, XppValue][] };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const VOID: XppValue = { type: "void" };
export const NULL: XppValue = { type: "null" };

export const int = (value: number): XppValue => ({ type: "int", value: Math.trunc(value) });
export const real = (value: number): XppValue => ({ type: "real", value });
export const str = (value: string): XppValue => ({ type: "str", value });
export const bool = (value: boolean): XppValue => ({ type: "boolean", value });
export const date = (value: string): XppValue => ({ type: "date", value });

/**
 * The zero value for a declared type.
 *
 * X++ has no "undefined": a declared variable is immediately usable, and an unassigned
 * `str` is `""` rather than null. C/AL developers find this familiar; C# developers do
 * not, which is why lesson 1 mentions it.
 */
export function defaultValueFor(typeName: string): XppValue {
  switch (typeName.toLowerCase()) {
    case "int":
      return { type: "int", value: 0 };
    case "int64":
      return { type: "int64", value: 0 };
    case "real":
      return { type: "real", value: 0 };
    case "str":
      return { type: "str", value: "" };
    case "boolean":
      return { type: "boolean", value: false };
    case "date":
      // The X++ null date. Formatting it is the runtime's business, not the DB's.
      return { type: "date", value: "" };
    case "utcdatetime":
      return { type: "utcdatetime", value: "" };
    case "guid":
      return { type: "guid", value: "" };
    case "container":
      return { type: "container", elements: [] };
    default:
      return NULL;
  }
}

// ---------------------------------------------------------------------------
// Coercions
// ---------------------------------------------------------------------------

/** Truthiness. X++ treats 0, "", and an empty buffer as false. */
export function toBoolean(value: XppValue): boolean {
  switch (value.type) {
    case "boolean":
      return value.value;
    case "int":
    case "int64":
    case "real":
    case "enum":
      return value.value !== 0;
    case "str":
      return value.value.length > 0;
    case "buffer":
      return !value.buffer.isEmpty;
    case "container":
      return value.elements.length > 0;
    case "null":
    case "void":
      return false;
    default:
      return true;
  }
}

export function toNumber(value: XppValue): number {
  switch (value.type) {
    case "int":
    case "int64":
    case "real":
    case "enum":
      return value.value;
    case "boolean":
      return value.value ? 1 : 0;
    case "str": {
      const parsed = Number(value.value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    default:
      return 0;
  }
}

/**
 * How a value appears in the Infolog and in `strFmt`.
 *
 * Enums render as their *value name*, not their ordinal — that is what a real Infolog
 * shows, and a learner who sees `1` instead of `Yes` learns the wrong thing.
 */
export function toDisplayString(value: XppValue): string {
  switch (value.type) {
    case "str":
      return value.value;
    case "int":
    case "int64":
      return String(value.value);
    case "real":
      // X++ shows reals to two decimals by default.
      return value.value.toFixed(2);
    case "boolean":
      return value.value ? "Yes" : "No";
    case "enum":
      return value.valueName;
    case "date":
    case "utcdatetime":
    case "guid":
      return value.value;
    case "container":
      return `[${value.elements.map(toDisplayString).join(", ")}]`;
    case "buffer":
      return value.buffer.isEmpty ? "" : value.buffer.tableName;
    case "collection":
      return value.collection.kind;
    case "object":
      return value.instance.className;
    case "queryObject":
      return value.object.kind;
    case "null":
      return "";
    case "void":
      return "";
  }
}

/** The value as it crosses into SQL. */
export function toSqlValue(value: XppValue): SqlValue {
  switch (value.type) {
    case "int":
    case "int64":
    case "real":
    case "enum":
      return value.value;
    case "boolean":
      return value.value ? 1 : 0;
    case "str":
    case "date":
    case "utcdatetime":
    case "guid":
      return value.value;
    case "null":
    case "void":
      return null;
    default:
      return null;
  }
}

/** A column read back out of SQLite, given what the field is declared as. */
export function fromSqlValue(value: SqlValue, fieldType: string, enumName?: string): XppValue {
  if (value === null) return defaultValueFor(fieldType);

  switch (fieldType) {
    case "int":
      return { type: "int", value: Number(value) };
    case "int64":
      return { type: "int64", value: Number(value) };
    case "real":
      return { type: "real", value: Number(value) };
    case "enum":
      return {
        type: "enum",
        enumName: enumName ?? "",
        valueName: String(value),
        value: Number(value),
      };
    default:
      return { type: "str", value: String(value) };
  }
}

/** Whether two values are `==` in X++ terms. */
export function valuesEqual(left: XppValue, right: XppValue): boolean {
  if (left.type === "str" || right.type === "str") {
    if (left.type === "str" && right.type === "str") return left.value === right.value;
    return toDisplayString(left) === toDisplayString(right);
  }
  if (left.type === "null" || right.type === "null") {
    return left.type === right.type;
  }
  if (left.type === "container" && right.type === "container") {
    return (
      left.elements.length === right.elements.length &&
      left.elements.every((element, index) => valuesEqual(element, right.elements[index]!))
    );
  }
  return toNumber(left) === toNumber(right);
}

/** `int` unless one side is a `real`, matching X++'s arithmetic result type. */
export function arithmeticResult(left: XppValue, right: XppValue, result: number): XppValue {
  const isReal = left.type === "real" || right.type === "real";
  return isReal ? real(result) : int(result);
}
