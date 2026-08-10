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

export { selectToSql, isCompiled } from "./core/selectToSql.js";
export type { CompiledSelect, SelectCompilation, SelectToSqlOptions } from "./core/selectToSql.js";
