/**
 * Schema shapes for the virtual AOS database.
 *
 * Table and field *names* mirror the real F&O public API surface, which is fine to
 * reference. Everything else — column sets, seed rows, relations — is hand-authored
 * here and deliberately smaller than the real thing. No extracted Microsoft metadata.
 * See CLAUDE.md > Legal rule.
 */

import type { CompanyId } from "@xpplab/xpp-core";

/** The starter table set for Phase 1. Widening this is a scope decision, not a detail. */
export const TABLE_NAMES = [
  "CustTable",
  "CustTrans",
  "VendTable",
  "InventTable",
  "InventSum",
  "SalesTable",
  "SalesLine",
  "MainAccount",
  "LedgerJournalTable",
  "LedgerJournalTrans",
  "WMSLocation",
  "InventLocation",
  "DirPartyTable",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/**
 * The X++ base types a simulated field can have. Each maps to a SQLite storage class
 * plus a conversion pair; the mapping lives in Phase 1's implementation.
 */
export type FieldType =
  "str" | "int" | "int64" | "real" | "date" | "utcdatetime" | "enum" | "guid" | "container";

export interface FieldSchema {
  name: string;
  type: FieldType;
  /** For `str` fields. Purely informational until Phase 7 shows it in the property grid. */
  length?: number;
  /** For `enum` fields — the base enum name in the virtual AOT. */
  enumName?: string;
  /** The EDT this field extends, when it has one. Drives Phase 7 lessons. */
  edt?: string;
  mandatory?: boolean;
  /** Rendered label. Real F&O gets this from the label file; we author it inline. */
  label?: string;
}

export interface IndexSchema {
  name: string;
  fields: string[];
  unique: boolean;
  /** The index F&O would use as the primary/clustered one. */
  primary?: boolean;
}

export interface RelationSchema {
  name: string;
  /** The table this relation points at. */
  relatedTable: TableName;
  /** `[thisField, relatedField]` pairs. */
  fields: ReadonlyArray<readonly [string, string]>;
}

export interface TableSchema {
  name: TableName;
  label: string;
  /**
   * Fields *excluding* the two the engine adds to every table. `RECID` (int64,
   * autoincrement) and `DATAAREAID` (str 4) are implicit, exactly as they are in F&O.
   */
  fields: FieldSchema[];
  indexes: IndexSchema[];
  relations: RelationSchema[];
  /**
   * `false` for tables that are shared across companies rather than company-scoped.
   * `DirPartyTable` is the reason this flag exists — it is genuinely global in F&O, and
   * that contrast is the whole point of the companies lesson.
   */
  saveDataPerCompany: boolean;
}

export interface CompanyDefinition {
  id: CompanyId;
  name: string;
  currency: string;
}

/** TODO(phase-1): the hand-authored table definitions. */
export const SCHEMA: readonly TableSchema[] = [];

/**
 * Three fictional legal entities, so cross-company lessons have something to show.
 * TODO(phase-1): author these.
 */
export const COMPANIES: readonly CompanyDefinition[] = [];

export function getTableSchema(_name: string): TableSchema | undefined {
  throw new Error("not implemented");
}
