/**
 * The worker protocol.
 *
 * The database runs in a Web Worker so a runaway `while select` cannot lock the UI
 * thread. That means every operation is a message, and the client half of `VirtualDb`
 * is a thin proxy over these.
 *
 * `createRequestHandler` is where all the logic lives, and it is plain async code with
 * no `postMessage` in sight. Both transports — the real worker and the in-process one
 * used by tests and by Node — drive the same handler, so the tested path is the shipped
 * path. `worker.ts` is only the postMessage wiring around it.
 */

import type { CompanyId, SqlTraceEntry, SqlValue } from "@xpplab/xpp-core";
import { DbCore, type DbCoreOptions, type ReadRowsOptions } from "../core/database.js";
import type { SeedName } from "../seeds/index.js";
import type { TableName } from "../schema.js";

export interface SnapshotPayload {
  seed: SeedName;
  bytes: Uint8Array;
}

export type DbRequest =
  | { op: "exec"; sql: string; parameters: SqlValue[]; sourceLine?: number }
  | { op: "beginTransaction" }
  | { op: "commitTransaction" }
  | { op: "abortTransaction" }
  | { op: "getTransactionState" }
  | { op: "setCompany"; company: CompanyId }
  | { op: "listCompanies" }
  | { op: "listTables" }
  | { op: "readRows"; table: TableName; options: ReadRowsOptions }
  | { op: "snapshot" }
  | { op: "restore"; snapshot: SnapshotPayload }
  | { op: "reset"; seed?: SeedName }
  | { op: "close" };

export type DbResult =
  | {
      ok: true;
      value: unknown;
      /**
       * Trace entries produced by *this* request. The client accumulates them, which is
       * what lets `VirtualDb.getTrace()` stay synchronous across a worker boundary.
       */
      trace: SqlTraceEntry[];
    }
  | { ok: false; error: string };

export interface RequestHandler {
  handle(request: DbRequest): Promise<DbResult>;
}

export async function createRequestHandler(options: DbCoreOptions = {}): Promise<RequestHandler> {
  const core = await DbCore.create(options);

  return {
    async handle(request: DbRequest): Promise<DbResult> {
      try {
        const value = await dispatch(core, request);
        // Drain rather than read: each response carries only what this request produced.
        const trace = core.getTrace();
        core.clearTrace();
        return { ok: true, value, trace };
      } catch (error) {
        // The worker boundary cannot carry an Error instance, and the interpreter turns
        // this string into a proper XppError in Phase 3.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function dispatch(core: DbCore, request: DbRequest): Promise<unknown> {
  switch (request.op) {
    case "exec":
      return core.exec(request.sql, request.parameters, request.sourceLine);
    case "beginTransaction":
      return core.beginTransaction();
    case "commitTransaction":
      return core.commitTransaction();
    case "abortTransaction":
      return core.abortTransaction();
    case "getTransactionState":
      return core.getTransactionState();
    case "setCompany":
      return core.setCompany(request.company);
    case "listCompanies":
      return core.listCompanies();
    case "listTables":
      return core.listTables();
    case "readRows":
      return core.readRows(request.table, request.options);
    case "snapshot":
      return core.snapshot();
    case "restore":
      return core.restore(request.snapshot);
    case "reset":
      return core.reset(request.seed);
    case "close":
      return core.close();
  }
}
