/**
 * The client half of `VirtualDb`.
 *
 * A thin proxy over a `Transport`. Two exist: the real Web Worker, and an in-process one
 * that calls the handler directly. Node and Vitest use the in-process transport, so the
 * engine is testable without a DOM; the browser uses the worker, so a runaway loop
 * cannot lock the UI.
 *
 * Two pieces of state are mirrored on this side because the `VirtualDb` interface exposes
 * them synchronously and a worker cannot answer synchronously:
 *   - the active company, updated after each successful `setCompany`
 *   - the SQL trace, accumulated from the entries each response carries back
 */

import type { CompanyId, SqlTraceEntry, SqlValue } from "@xpplab/xpp-core";
import { DEFAULT_COMPANY, getCompany, type TableName } from "./schema";
import type { SeedName } from "./seeds/index";
import type { QueryResult, ReadRowsOptions, Row } from "./core/database";
import type { TransactionState } from "./core/transactions";
import {
  createRequestHandler,
  type DbRequest,
  type DbResult,
  type SnapshotPayload,
} from "./worker/protocol";

export interface Transport {
  send(request: DbRequest): Promise<DbResult>;
  terminate(): void;
}

/**
 * The part of `Worker` this package uses.
 *
 * Structural rather than the DOM `Worker` type on purpose: engine packages compile
 * without the DOM lib, so nothing below /components can reach for `document` by
 * accident. A real `Worker` satisfies this.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface Snapshot {
  readonly id: string;
  readonly seed: SeedName;
  readonly bytes: Uint8Array;
  readonly takenAt: number;
}

export interface VirtualDbOptions {
  seed?: SeedName;
  /** Company the session starts in. Defaults to the first entry in `COMPANIES`. */
  company?: CompanyId;
  /**
   * Where to fetch `sql-wasm.wasm` from. The app serves it from `/public`; in Node it is
   * resolved out of `node_modules` and this can be omitted.
   */
  wasmUrl?: string;
  /**
   * Supply a transport to run the database somewhere specific. Defaults to in-process,
   * which is what tests and Node want; Phase 4's browser client passes a worker
   * transport built by `createWorkerTransport`.
   */
  transport?: Transport;
}

export interface VirtualDb {
  init(): Promise<void>;

  exec(sql: string, parameters?: SqlValue[], sourceLine?: number): Promise<QueryResult>;

  beginTransaction(): Promise<TransactionState>;
  commitTransaction(): Promise<TransactionState>;
  abortTransaction(): Promise<TransactionState>;
  getTransactionState(): Promise<TransactionState>;

  getCompany(): CompanyId;
  setCompany(company: CompanyId): Promise<void>;
  listCompanies(): Promise<CompanyId[]>;

  listTables(): Promise<TableName[]>;
  readRows(table: TableName, options?: ReadRowsOptions): Promise<Row[]>;

  getTrace(): SqlTraceEntry[];
  clearTrace(): void;

  snapshot(): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<void>;
  reset(seed?: SeedName): Promise<void>;
  close(): Promise<void>;
}

/**
 * Runs the database on the calling thread. No worker, no structured cloning — the
 * handler is called directly.
 */
export async function createInProcessTransport(options: {
  seed?: SeedName;
  company?: CompanyId;
  wasmUrl?: string;
}): Promise<Transport> {
  const handler = await createRequestHandler(options);
  return {
    send: (request) => handler.handle(request),
    terminate: () => {},
  };
}

/**
 * Runs the database in a Web Worker. The caller constructs the `Worker` so the bundler
 * can see the `new Worker(new URL(...))` call site — passing a path through here would
 * defeat that.
 */
export function createWorkerTransport(
  worker: WorkerLike,
  options: { seed?: SeedName; company?: CompanyId; wasmUrl?: string },
): Transport {
  let nextId = 0;
  const pending = new Map<number, (result: DbResult) => void>();

  worker.onmessage = (event) => {
    const reply = event.data as { id: number } & DbResult;
    const resolve = pending.get(reply.id);
    if (resolve === undefined) return;
    pending.delete(reply.id);
    resolve(reply.ok ? { ok: true, value: reply.value, trace: reply.trace } : reply);
  };

  const post = (message: Record<string, unknown>): Promise<DbResult> => {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ id, ...message });
    });
  };

  const ready = post({ kind: "init", options });

  return {
    async send(request) {
      const initResult = await ready;
      if (!initResult.ok) return initResult;
      return post({ kind: "request", request });
    },
    terminate: () => worker.terminate(),
  };
}

class VirtualDbClient implements VirtualDb {
  readonly #options: VirtualDbOptions;
  #transport: Transport | undefined;
  #company: CompanyId;
  #trace: SqlTraceEntry[] = [];

  constructor(options: VirtualDbOptions) {
    this.#options = options;
    this.#company = options.company ?? DEFAULT_COMPANY;
    if (getCompany(this.#company) === undefined) {
      throw new Error(`Unknown company "${this.#company}".`);
    }
    if (options.transport !== undefined) this.#transport = options.transport;
  }

  async init(): Promise<void> {
    this.#transport ??= await createInProcessTransport({
      ...(this.#options.seed === undefined ? {} : { seed: this.#options.seed }),
      company: this.#company,
      ...(this.#options.wasmUrl === undefined ? {} : { wasmUrl: this.#options.wasmUrl }),
    });
    // Touch the transport so a failed boot surfaces here rather than on first query.
    await this.#send({ op: "getTransactionState" });
  }

  async #send(request: DbRequest): Promise<unknown> {
    if (this.#transport === undefined) {
      throw new Error("The virtual database has not been initialised. Call init() first.");
    }
    const result = await this.#transport.send(request);
    if (!result.ok) throw new Error(result.error);
    this.#trace.push(...result.trace);
    return result.value;
  }

  exec(sql: string, parameters: SqlValue[] = [], sourceLine?: number): Promise<QueryResult> {
    return this.#send({
      op: "exec",
      sql,
      parameters,
      ...(sourceLine === undefined ? {} : { sourceLine }),
    }) as Promise<QueryResult>;
  }

  beginTransaction(): Promise<TransactionState> {
    return this.#send({ op: "beginTransaction" }) as Promise<TransactionState>;
  }

  commitTransaction(): Promise<TransactionState> {
    return this.#send({ op: "commitTransaction" }) as Promise<TransactionState>;
  }

  abortTransaction(): Promise<TransactionState> {
    return this.#send({ op: "abortTransaction" }) as Promise<TransactionState>;
  }

  getTransactionState(): Promise<TransactionState> {
    return this.#send({ op: "getTransactionState" }) as Promise<TransactionState>;
  }

  getCompany(): CompanyId {
    return this.#company;
  }

  async setCompany(company: CompanyId): Promise<void> {
    await this.#send({ op: "setCompany", company });
    this.#company = company;
  }

  listCompanies(): Promise<CompanyId[]> {
    return this.#send({ op: "listCompanies" }) as Promise<CompanyId[]>;
  }

  listTables(): Promise<TableName[]> {
    return this.#send({ op: "listTables" }) as Promise<TableName[]>;
  }

  readRows(table: TableName, options: ReadRowsOptions = {}): Promise<Row[]> {
    return this.#send({ op: "readRows", table, options }) as Promise<Row[]>;
  }

  getTrace(): SqlTraceEntry[] {
    return [...this.#trace];
  }

  clearTrace(): void {
    this.#trace = [];
  }

  async snapshot(): Promise<Snapshot> {
    const payload = (await this.#send({ op: "snapshot" })) as SnapshotPayload;
    return {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      seed: payload.seed,
      bytes: payload.bytes,
      takenAt: Date.now(),
    };
  }

  async restore(snapshot: Snapshot): Promise<void> {
    await this.#send({
      op: "restore",
      snapshot: { seed: snapshot.seed, bytes: snapshot.bytes },
    });
    this.clearTrace();
  }

  async reset(seed?: SeedName): Promise<void> {
    await this.#send({ op: "reset", ...(seed === undefined ? {} : { seed }) });
    this.clearTrace();
  }

  async close(): Promise<void> {
    if (this.#transport === undefined) return;
    await this.#send({ op: "close" });
    this.#transport.terminate();
    this.#transport = undefined;
  }
}

export function createVirtualDb(options: VirtualDbOptions = {}): VirtualDb {
  return new VirtualDbClient(options);
}
