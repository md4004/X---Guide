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

export * from "./schema";
export * from "./enums";
export * from "./seeds/index";

export { createVirtualDb, createInProcessTransport, createWorkerTransport } from "./client";
export type { Snapshot, Transport, VirtualDb, VirtualDbOptions, WorkerLike } from "./client";

export { DbCore } from "./core/database";
export type { DbCoreOptions, QueryResult, ReadRowsOptions, Row } from "./core/database";

export { SavepointStack } from "./core/savepoints";
export { TransactionManager } from "./core/transactions";
export type { TransactionState } from "./core/transactions";

export { createSchemaStatements, createTableStatement, createIndexStatements } from "./core/ddl";

export { createRequestHandler } from "./worker/protocol";
export type { DbRequest, DbResult, RequestHandler, SnapshotPayload } from "./worker/protocol";

export { selectToSql, isCompiled } from "./core/selectToSql";
export type { CompiledSelect, SelectCompilation, SelectToSqlOptions } from "./core/selectToSql";
