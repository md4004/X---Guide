/**
 * The engine worker.
 *
 * The parser, the interpreter and the SQLite database all live in here, not just the
 * database. That matters: a learner's first infinite loop is a matter of when, not if,
 * and a tree-walking interpreter spinning on `while (n >= 0) n++;` has no await to yield
 * on. Running it on the main thread would freeze the tab until the statement budget
 * tripped. Here it cannot.
 *
 * The worker owns one long-lived database for the session, so a run sees what the
 * previous run did — the playground is a sandbox, not a lesson runner. Reset is explicit.
 */

import { createVirtualDb, RECID_FIELD, type TableName, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "@xpplab/xpp-runtime";
import type { EngineReply, EngineRequest, TableSnapshot } from "./run-protocol.js";

let db: VirtualDb | undefined;

async function database(): Promise<VirtualDb> {
  if (db === undefined) {
    db = createVirtualDb({ wasmUrl: "/sql-wasm.wasm" });
    await db.init();
  }
  return db;
}

async function snapshotTables(
  instance: VirtualDb,
  tables: TableName[],
  before: Map<TableName, Map<number, string>>,
): Promise<TableSnapshot[]> {
  const snapshots: TableSnapshot[] = [];

  for (const table of tables) {
    const rows = await instance.readRows(table);
    const columns = rows[0] === undefined ? [] : Object.keys(rows[0]);

    // A row counts as changed if it is new, or if any field differs from before the run.
    const previous = before.get(table);
    const changedRecIds =
      previous === undefined
        ? []
        : rows
            .filter((row) => {
              const recId = Number(row[RECID_FIELD]);
              const was = previous.get(recId);
              return was === undefined || was !== JSON.stringify(row);
            })
            .map((row) => Number(row[RECID_FIELD]));

    snapshots.push({ table, columns, rows, changedRecIds });
  }

  return snapshots;
}

async function fingerprint(
  instance: VirtualDb,
  tables: TableName[],
): Promise<Map<TableName, Map<number, string>>> {
  const before = new Map<TableName, Map<number, string>>();
  for (const table of tables) {
    const rows = await instance.readRows(table);
    before.set(table, new Map(rows.map((row) => [Number(row[RECID_FIELD]), JSON.stringify(row)])));
  }
  return before;
}

async function handle(request: EngineRequest): Promise<EngineReply> {
  const instance = await database();

  if (request.kind === "reset") {
    await instance.reset(request.seed);
    const tables = await snapshotTables(instance, request.tables, new Map());
    return {
      id: request.id,
      ok: true,
      result: {
        infolog: [],
        sqlTrace: [],
        errors: [],
        statementsExecuted: 0,
        durationMs: 0,
        uncommittedTransactionDepth: 0,
        parseFailed: false,
        tables,
        companies: await instance.listCompanies(),
        company: instance.getCompany(),
      },
    };
  }

  if (request.kind === "read") {
    if (instance.getCompany() !== request.company) await instance.setCompany(request.company);
    const tables = await snapshotTables(instance, request.tables, new Map());
    return {
      id: request.id,
      ok: true,
      result: {
        infolog: [],
        sqlTrace: [],
        errors: [],
        statementsExecuted: 0,
        durationMs: 0,
        uncommittedTransactionDepth: 0,
        parseFailed: false,
        tables,
        companies: await instance.listCompanies(),
        company: instance.getCompany(),
      },
    };
  }

  if (instance.getCompany() !== request.company) await instance.setCompany(request.company);

  const before = await fingerprint(instance, request.tables);
  const result = await runSource({ source: request.source, db: instance });

  // The run may have left the session in another company via changecompany — read the
  // Data panel from wherever it ended up, which is what the learner will expect.
  const tables = await snapshotTables(instance, request.tables, before);

  return {
    id: request.id,
    ok: true,
    result: {
      infolog: result.infolog,
      sqlTrace: result.sqlTrace,
      errors: result.errors,
      statementsExecuted: result.statementsExecuted,
      durationMs: result.durationMs,
      uncommittedTransactionDepth: result.uncommittedTransactionDepth,
      parseFailed: result.parseFailed,
      tables,
      companies: await instance.listCompanies(),
      company: instance.getCompany(),
    },
  };
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  void handle(request)
    .then((reply) => self.postMessage(reply))
    .catch((error: unknown) => {
      // A failure here is ours, not the learner's, and it should say so rather than
      // masquerading as an X++ error.
      const reply: EngineReply = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(reply);
    });
};
