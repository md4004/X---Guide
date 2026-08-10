/**
 * @xpplab/virtual-db — the virtual AOS database.
 *
 * sql.js (SQLite compiled to WASM) running in a Web Worker, seeded with hand-authored
 * fictional data. Every method on `VirtualDb` is async because every method may cross
 * the worker boundary.
 *
 * Layout:
 *   schema.ts        table and field definitions, the three legal entities
 *   enums.ts         base enums the schema and seeds reference
 *   seeds/           the hand-authored datasets
 *   core/            everything that touches SQLite, all synchronous
 *   worker/          the message protocol and the Web Worker entry point
 *   client.ts        the async `VirtualDb` proxy over a transport
 */

export * from "./schema.js";
export * from "./enums.js";
export * from "./seeds/index.js";

export { createVirtualDb, createInProcessTransport, createWorkerTransport } from "./client.js";
export type { Snapshot, Transport, VirtualDb, VirtualDbOptions, WorkerLike } from "./client.js";

export { DbCore } from "./core/database.js";
export type { DbCoreOptions, QueryResult, ReadRowsOptions, Row } from "./core/database.js";

export { SavepointStack } from "./core/savepoints.js";
export { TransactionManager } from "./core/transactions.js";
export type { TransactionState } from "./core/transactions.js";

export { createSchemaStatements, createTableStatement, createIndexStatements } from "./core/ddl.js";

export { createRequestHandler } from "./worker/protocol.js";
export type { DbRequest, DbResult, RequestHandler, SnapshotPayload } from "./worker/protocol.js";

// ---------------------------------------------------------------------------
// select → SQL
// ---------------------------------------------------------------------------

import type { SqlValue, XppError } from "@xpplab/xpp-core";
import type { SelectClauses } from "@xpplab/xpp-parser";
import type { CompanyId } from "@xpplab/xpp-core";
import type { TableName } from "./schema.js";

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
 * Implemented in Phase 3, once the parser exists to produce a `SelectClauses`.
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
