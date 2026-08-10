/**
 * The database core.
 *
 * Owns the sql.js handle, the savepoint stack, the transaction manager and the trace.
 * Everything here is synchronous — the async surface belongs to the transports, because
 * only they cross a worker boundary.
 */

import type { CompanyId, SqlValue } from "@xpplab/xpp-core";
import {
  COMPANIES,
  DATAAREAID_FIELD,
  DEFAULT_COMPANY,
  RECID_FIELD,
  SCHEMA,
  getCompany,
  getTableSchema,
  type TableName,
} from "../schema";
import { getSeed, type SeedName } from "../seeds/index";
import { createSchemaStatements, dropSchemaStatements } from "./ddl";
import { SavepointStack } from "./savepoints";
import { SqlTrace } from "./trace";
import { TransactionManager, type TransactionState } from "./transactions";
import { openDatabase, type SqliteHandle } from "./sqlite";

export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
  rowsAffected: number;
}

export type Row = Record<string, SqlValue>;

export interface ReadRowsOptions {
  /** `"all"` ignores DATAAREAID — this is what `crosscompany` compiles to. */
  company?: CompanyId | "all";
  limit?: number;
  offset?: number;
}

export interface DbCoreOptions {
  seed?: SeedName;
  company?: CompanyId;
  wasmUrl?: string;
}

export class DbCore {
  #sqlite: SqliteHandle;
  #savepoints: SavepointStack;
  #transactions: TransactionManager;
  readonly #trace = new SqlTrace();
  #company: CompanyId;
  #seed: SeedName;
  readonly #wasmUrl: string | undefined;

  private constructor(sqlite: SqliteHandle, company: CompanyId, seed: SeedName, wasmUrl?: string) {
    this.#sqlite = sqlite;
    this.#company = company;
    this.#seed = seed;
    this.#wasmUrl = wasmUrl;
    this.#savepoints = this.#newSavepointStack();
    this.#transactions = new TransactionManager(this.#savepoints);
  }

  static async create(options: DbCoreOptions = {}): Promise<DbCore> {
    const company = options.company ?? DEFAULT_COMPANY;
    if (getCompany(company) === undefined) {
      throw new Error(`Unknown company "${company}".`);
    }

    const seed = options.seed ?? "default";
    const sqlite = await openDatabase({
      ...(options.wasmUrl === undefined ? {} : { wasmUrl: options.wasmUrl }),
    });
    const core = new DbCore(sqlite, company, seed, options.wasmUrl);
    core.#buildSchema();
    core.#applySeed(seed);
    // Init statements are plumbing, not something a learner wrote.
    core.#trace.clear();
    return core;
  }

  // -- schema and seeding --------------------------------------------------

  #newSavepointStack(): SavepointStack {
    return new SavepointStack(this.#sqlite, (kind, sql, depthAfter) => {
      this.#trace.record({ sql, rowCount: 0, transactionDepth: depthAfter, kind });
    });
  }

  #buildSchema(): void {
    for (const statement of createSchemaStatements()) {
      this.#sqlite.run(statement);
    }
  }

  #applySeed(name: SeedName): void {
    const seed = getSeed(name);

    for (const table of SCHEMA) {
      const rows = seed.rows[table.name];
      if (rows === undefined || rows.length === 0) continue;

      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.includes(DATAAREAID_FIELD)) {
          throw new Error(
            `Seed "${name}" has a row in ${table.name} with no ${DATAAREAID_FIELD}. Every seeded row must state its company.`,
          );
        }
        const placeholders = columns.map(() => "?").join(", ");
        this.#sqlite.run(
          `INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${placeholders})`,
          columns.map((column) => row[column] ?? null),
        );
      }
    }
  }

  // -- statements -----------------------------------------------------------

  /**
   * Runs a parameterised statement and records it in the learner-visible trace.
   *
   * There is deliberately no convenience overload that takes interpolated SQL. Every
   * statement the engine issues is parameterised, and the trace panel shows it that way.
   */
  exec(sql: string, parameters: SqlValue[] = [], sourceLine?: number): QueryResult {
    const trimmed = sql.trimStart().slice(0, 6).toLowerCase();
    let result: QueryResult;

    if (trimmed.startsWith("select") || trimmed.startsWith("pragma")) {
      const selected = this.#sqlite.select(sql, parameters);
      result = { ...selected, rowsAffected: 0 };
    } else {
      const rowsAffected = this.#sqlite.run(sql, parameters);
      result = { columns: [], rows: [], rowsAffected };
    }

    this.#trace.record({
      sql,
      parameters,
      rowCount: result.rows.length > 0 ? result.rows.length : result.rowsAffected,
      transactionDepth: this.#transactions.depth,
      ...(sourceLine === undefined ? {} : { sourceLine }),
    });

    return result;
  }

  // -- transactions ---------------------------------------------------------

  beginTransaction(): TransactionState {
    return this.#transactions.begin();
  }

  commitTransaction(): TransactionState {
    return this.#transactions.commit();
  }

  abortTransaction(): TransactionState {
    return this.#transactions.abort();
  }

  getTransactionState(): TransactionState {
    return this.#transactions.state;
  }

  // -- companies ------------------------------------------------------------

  getCompany(): CompanyId {
    return this.#company;
  }

  setCompany(company: CompanyId): void {
    if (getCompany(company) === undefined) {
      throw new Error(
        `Unknown company "${company}". Available companies: ${COMPANIES.map((c) => c.id).join(", ")}.`,
      );
    }
    this.#company = company;
  }

  listCompanies(): CompanyId[] {
    return COMPANIES.map((company) => company.id);
  }

  // -- browsing -------------------------------------------------------------

  listTables(): TableName[] {
    return SCHEMA.map((table) => table.name);
  }

  /**
   * Reads rows for the Data panel and for `state` validators.
   *
   * Deliberately does not touch the trace: this is the harness looking at the database,
   * not the learner's code doing so, and mixing the two would make the trace a lie.
   */
  readRows(table: TableName, options: ReadRowsOptions = {}): Row[] {
    const schema = getTableSchema(table);
    if (schema === undefined) {
      throw new Error(`Unknown table "${table}".`);
    }

    const parameters: SqlValue[] = [];
    let sql = `SELECT * FROM ${schema.name}`;

    // Shared tables are not company-scoped, so filtering them would return nothing.
    const company = options.company ?? this.#company;
    if (schema.saveDataPerCompany && company !== "all") {
      sql += ` WHERE ${DATAAREAID_FIELD} = ?`;
      parameters.push(company);
    }

    sql += ` ORDER BY ${RECID_FIELD}`;

    if (options.limit !== undefined) {
      sql += " LIMIT ?";
      parameters.push(options.limit);
      if (options.offset !== undefined) {
        sql += " OFFSET ?";
        parameters.push(options.offset);
      }
    }

    const { columns, rows } = this.#sqlite.select(sql, parameters);
    return rows.map((values) => Object.fromEntries(columns.map((c, i) => [c, values[i] ?? null])));
  }

  // -- trace ----------------------------------------------------------------

  getTrace() {
    return this.#trace.entries();
  }

  clearTrace(): void {
    this.#trace.clear();
  }

  // -- lifecycle ------------------------------------------------------------

  /** Serialises the whole database, open transactions and all. */
  snapshot(): { seed: SeedName; bytes: Uint8Array } {
    return { seed: this.#seed, bytes: this.#sqlite.export() };
  }

  /**
   * Replaces the database wholesale. The savepoint stack is rebuilt from scratch rather
   * than carried over: the old savepoints belonged to a database that no longer exists.
   */
  async restore(snapshot: { seed: SeedName; bytes: Uint8Array }): Promise<void> {
    this.#sqlite.close();
    this.#sqlite = await openDatabase({
      bytes: snapshot.bytes,
      ...(this.#wasmUrl === undefined ? {} : { wasmUrl: this.#wasmUrl }),
    });
    this.#seed = snapshot.seed;
    this.#savepoints = this.#newSavepointStack();
    this.#transactions = new TransactionManager(this.#savepoints);
    this.#trace.clear();
  }

  /** Drops everything and rebuilds from a seed. */
  reset(seed: SeedName = this.#seed): void {
    this.#transactions.reset();
    for (const statement of dropSchemaStatements()) {
      this.#sqlite.run(statement);
    }
    // AUTOINCREMENT counters live here; clearing it makes a reset truly reproducible.
    this.#sqlite.run("DELETE FROM sqlite_sequence");
    this.#buildSchema();
    this.#applySeed(seed);
    this.#seed = seed;
    this.#trace.clear();
  }

  close(): void {
    this.#sqlite.close();
  }
}
