/**
 * The sql.js boundary.
 *
 * Everything above this file works with `SqliteHandle` and never imports sql.js
 * directly, which keeps the rest of the package testable and keeps the WASM-loading
 * awkwardness in one place.
 */

import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import type { SqlValue } from "@xpplab/xpp-core";

export interface SelectResult {
  columns: string[];
  rows: SqlValue[][];
}

export interface SqliteHandle {
  /** Runs a statement that returns no rows. Returns rows changed. */
  run(sql: string, parameters?: SqlValue[]): number;
  /** Runs a query and materialises the result. */
  select(sql: string, parameters?: SqlValue[]): SelectResult;
  /** Serialises the whole database. Backs snapshots. */
  export(): Uint8Array;
  close(): void;
}

export interface OpenDatabaseOptions {
  /**
   * Where to fetch `sql-wasm.wasm` from.
   *
   * In the browser the app serves it from `/public`. In Node it is resolved out of
   * `node_modules` automatically, so tests need not pass anything.
   */
  wasmUrl?: string;
  /** Restore from a previous `export()` instead of creating an empty database. */
  bytes?: Uint8Array;
}

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

const isNode = typeof process !== "undefined" && process.versions?.node !== undefined;

async function locateWasm(wasmUrl: string | undefined): Promise<string> {
  if (wasmUrl !== undefined) return wasmUrl;

  if (isNode) {
    // Resolve out of node_modules so Vitest needs no fixture copying or setup file.
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    return require.resolve("sql.js/dist/sql-wasm.wasm");
  }

  // The browser default. Phase 4 copies the file into /public at build time.
  return "/sql-wasm.wasm";
}

/**
 * Loads and caches the sql.js runtime. The WASM module is compiled once per process (or
 * per worker) — every database after the first is cheap.
 */
async function loadSqlJs(wasmUrl: string | undefined): Promise<SqlJsStatic> {
  sqlJsPromise ??= locateWasm(wasmUrl).then((file) => initSqlJs({ locateFile: () => file }));
  return sqlJsPromise;
}

/** Visible for tests that need a clean WASM load. */
export function resetSqlJsCache(): void {
  sqlJsPromise = undefined;
}

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<SqliteHandle> {
  const SQL = await loadSqlJs(options.wasmUrl);
  const db: Database =
    options.bytes === undefined ? new SQL.Database() : new SQL.Database(options.bytes);

  // Real relations exist in the schema, but the engine must not enforce them: a lesson
  // where a learner inserts an orphan line should fail the way F&O fails (a validation
  // error we raise ourselves in Phase 3), not with an opaque SQLite constraint error.
  db.run("PRAGMA foreign_keys = OFF");

  return {
    run(sql, parameters = []) {
      db.run(sql, parameters);
      return db.getRowsModified();
    },

    select(sql, parameters = []) {
      const statement = db.prepare(sql);
      try {
        statement.bind(parameters);
        const rows: SqlValue[][] = [];
        let columns: string[] = [];
        while (statement.step()) {
          if (columns.length === 0) columns = statement.getColumnNames();
          rows.push(statement.get() as SqlValue[]);
        }
        // A query that matched nothing still has a column list worth reporting.
        if (columns.length === 0) columns = statement.getColumnNames();
        return { columns, rows };
      } finally {
        statement.free();
      }
    },

    export: () => db.export(),
    close: () => db.close(),
  };
}
