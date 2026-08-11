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
import { runTask, type StepView } from "@xpplab/validators";
import { createVirtualAot } from "@xpplab/virtual-aot";
import {
  buildFormView,
  buildReportView,
  type FormViewModel,
  type ReportColumn,
  type ReportViewModel,
} from "@xpplab/renderers";
import type { EngineReply, EngineRequest, TableSnapshot } from "./run-protocol.js";

const aot = createVirtualAot();

let db: VirtualDb | undefined;

/**
 * Where `sql-wasm.wasm` is served from.
 *
 * Resolved here rather than in `virtual-db` because a base path is a deployment fact, and
 * the engine packages are not allowed to know anything about Next — the point at which
 * the app meets its host belongs in the app. Inlined at build time, so it survives into
 * the worker bundle.
 */
const WASM_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sql-wasm.wasm`;

async function database(): Promise<VirtualDb> {
  if (db === undefined) {
    db = createVirtualDb({ wasmUrl: WASM_URL });
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

/**
 * Builds whatever viewer the step asked for, from the state the run just produced.
 *
 * Called from `runTask`'s `observe` hook, which is the only moment the learner's changes
 * are still in the database — the runner restores its snapshot immediately after.
 */
async function buildView(
  view: StepView,
  instance: VirtualDb,
): Promise<{ form?: FormViewModel; report?: ReportViewModel }> {
  if (view.kind === "form") {
    const form = aot.getForm(view.form);
    if (form === undefined) throw new Error(`There is no form called ${view.form}.`);
    return { form: await buildFormView({ form, aot, db: instance }) };
  }

  const table = aot.getTable(view.table);
  if (table === undefined) throw new Error(`There is no table called ${view.table}.`);

  const rows = await instance.readRows(view.table as TableName);
  const columns: ReportColumn[] = table.fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.baseType === "real" ? "real" : field.baseType === "date" ? "date" : "str",
  }));

  return {
    report: buildReportView(
      { columns, rows },
      { title: view.title, groupBy: view.groupBy, totals: view.totals, pageSize: 40 },
    ),
  };
}

async function handle(request: EngineRequest): Promise<EngineReply> {
  const instance = await database();

  if (request.kind === "task") {
    let view: { form?: FormViewModel; report?: ReportViewModel } = {};
    let viewError: string | undefined;

    // `runTask` snapshots and restores around the run, so a lesson attempt never leaves
    // the environment changed for the next one — the runner contract, step 1 and 5.
    const result = await runTask({
      task: request.task,
      source: request.source,
      db: instance,
      ...(request.view === undefined
        ? {}
        : {
            observe: async (db) => {
              try {
                view = await buildView(request.view!, db);
              } catch (error: unknown) {
                viewError = error instanceof Error ? error.message : String(error);
              }
            },
          }),
    });

    return {
      id: request.id,
      ok: true,
      task: {
        passed: result.passed,
        ...(result.failure?.message === undefined ? {} : { message: result.failure.message }),
        parseErrors: result.parseErrors,
        runtimeErrors: result.runtimeErrors,
        infolog: result.run?.infolog ?? [],
        sqlTrace: result.run?.sqlTrace ?? [],
        ...view,
        ...(viewError === undefined ? {} : { viewError }),
      },
    };
  }

  if (request.kind === "preview") {
    // Snapshotted like a task: an example the learner ran must not change the data the
    // next exercise is checked against.
    const snapshot = await instance.snapshot();
    try {
      const result = await runSource({ source: request.source, db: instance });

      let view: { form?: FormViewModel; report?: ReportViewModel } = {};
      let viewError: string | undefined;
      if (request.view !== undefined) {
        try {
          view = await buildView(request.view, instance);
        } catch (error: unknown) {
          viewError = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        id: request.id,
        ok: true,
        task: {
          passed: true,
          preview: true,
          parseErrors: result.parseFailed ? result.errors : [],
          runtimeErrors: result.parseFailed ? [] : result.errors,
          infolog: result.infolog,
          sqlTrace: result.sqlTrace,
          ...view,
          ...(viewError === undefined ? {} : { viewError }),
        },
      };
    } finally {
      await instance.restore(snapshot);
    }
  }

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
