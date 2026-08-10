/**
 * @xpplab/virtual-db — the virtual AOS database.
 *
 * sql.js (SQLite compiled to WASM) running in a Web Worker, seeded with hand-authored
 * fictional data. Every method here is async because every method crosses the worker
 * boundary; the interpreter awaits them.
 */

import type { CompanyId, SqlTraceEntry, SqlValue, XppError } from "@xpplab/xpp-core";
import type { SelectClauses } from "@xpplab/xpp-parser";
import type { TableName } from "./schema.js";

export * from "./schema.js";

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/**
 * Named dataset variants. A lesson picks one via `seed:` in its frontmatter, so a
 * lesson about empty-result handling can start from an empty table without every other
 * lesson paying for it.
 */
export type SeedName = "default" | (string & {});

export interface SeedDefinition {
  name: SeedName;
  description: string;
  /** `rows[tableName][i]` is one record, keyed by field name. `RECID` is assigned. */
  rows: Partial<Record<TableName, ReadonlyArray<Record<string, SqlValue>>>>;
}

/** TODO(phase-1): author the seed data. */
export const SEEDS: Readonly<Record<string, SeedDefinition>> = {};

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
  /** Rows affected, for writes. */
  rowsAffected: number;
}

/** A row as the interpreter sees it: field name to value. */
export type Row = Record<string, SqlValue>;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * `ttsbegin`/`ttscommit` map to SQLite savepoints with real nesting depth. Aborting an
 * inner transaction must leave the outer one intact — that is the Phase 1 acceptance
 * test, and it is a lesson in its own right.
 */
export interface TransactionState {
  depth: number;
  /** Savepoint names, outermost first. */
  savepoints: string[];
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * An opaque full-database image. Taken before a lesson run and restored after, so a
 * learner's fourth attempt starts from the same state as the first.
 */
export interface Snapshot {
  readonly id: string;
  readonly seed: SeedName;
  readonly bytes: Uint8Array;
  readonly takenAt: number;
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

export interface VirtualDbOptions {
  seed?: SeedName;
  /** Company the session starts in. Defaults to the first entry in `COMPANIES`. */
  company?: CompanyId;
  /**
   * Where to fetch `sql-wasm.wasm` from. The app serves it from `/public`; tests point
   * at the file on disk.
   */
  wasmUrl?: string;
}

export interface VirtualDb {
  /** Boots the worker, loads the WASM, creates the schema and applies the seed. */
  init(): Promise<void>;

  /** Parameterised SQL only. Every call appends to the trace. */
  exec(sql: string, parameters?: SqlValue[]): Promise<QueryResult>;

  // -- transactions -------------------------------------------------------
  /** `ttsbegin`. Opens a savepoint one level deeper. */
  beginTransaction(): Promise<TransactionState>;
  /** `ttscommit`. Releases the innermost savepoint. */
  commitTransaction(): Promise<TransactionState>;
  /** `ttsabort`. Rolls back to the innermost savepoint and discards it. */
  abortTransaction(): Promise<TransactionState>;
  getTransactionState(): Promise<TransactionState>;

  // -- company scoping ----------------------------------------------------
  /** The active `DATAAREAID`. Every company-scoped read is filtered by it. */
  getCompany(): CompanyId;
  setCompany(company: CompanyId): Promise<void>;
  listCompanies(): Promise<CompanyId[]>;

  // -- data browsing (Phase 4's Data panel) --------------------------------
  listTables(): Promise<TableName[]>;
  /** Reads without appending to the learner-visible SQL trace. */
  readRows(
    table: TableName,
    options?: { company?: CompanyId | "all"; limit?: number; offset?: number },
  ): Promise<Row[]>;

  // -- trace ---------------------------------------------------------------
  /** Statements since the last `clearTrace()`, in execution order. */
  getTrace(): SqlTraceEntry[];
  clearTrace(): void;

  // -- lifecycle -----------------------------------------------------------
  snapshot(): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<void>;
  /** Drops everything and re-applies a seed from scratch. */
  reset(seed?: SeedName): Promise<void>;
  close(): Promise<void>;
}

export function createVirtualDb(_options?: VirtualDbOptions): VirtualDb {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// select → SQL
// ---------------------------------------------------------------------------

export interface SelectToSqlOptions {
  /** The active company, injected as a `DATAAREAID` predicate unless `crosscompany`. */
  company: CompanyId;
  /** Resolves a buffer variable name to the table it was declared as. */
  resolveBuffer: (name: string) => TableName | undefined;
}

export interface CompiledSelect {
  sql: string;
  parameters: SqlValue[];
  /** Buffer name to the columns it will be populated from, in `sql` column order. */
  outputs: Record<string, string[]>;
  /** `forupdate` was requested — the interpreter marks the buffer writable. */
  forUpdate: boolean;
}

/**
 * Compile a parsed `select` into parameterised SQL.
 *
 * Independently tested and independently readable on purpose: its output is a
 * user-visible feature, not an implementation detail. When a learner asks "why did my
 * loop run 400 statements", this function's output is the answer.
 */
export function selectToSql(
  _clauses: SelectClauses,
  _options: SelectToSqlOptions,
): CompiledSelect | { errors: XppError[] } {
  throw new Error("not implemented");
}
