/**
 * @xpplab/xpp-runtime — tree-walking interpreter for the X++ v1 subset.
 *
 * Not a compiler. It walks the AST, keeps a scope chain, dispatches methods, writes to
 * the Infolog and drives the virtual database's transaction manager.
 *
 * Two rules govern everything in here:
 *   1. It never throws a raw JS error across the package boundary. Failures come back
 *      as `XppError`.
 *   2. Runtime errors mirror real ones. `.insert()` outside a transaction must fail the
 *      way a real AOS fails, because that is a lesson, not an edge case.
 */

import type {
  CompanyId,
  InfologEntry,
  InfologType,
  SqlTraceEntry,
  XppError,
} from "@xpplab/xpp-core";
import type { SourceUnit } from "@xpplab/xpp-parser";
import type { Row, VirtualDb } from "@xpplab/virtual-db";
import type { VirtualAot } from "@xpplab/virtual-aot";

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Everything an X++ expression can evaluate to in the v1 subset. */
export type XppValue =
  | { type: "void" }
  | { type: "int"; value: number }
  | { type: "int64"; value: number }
  | { type: "real"; value: number }
  | { type: "str"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "utcdatetime"; value: string }
  | { type: "guid"; value: string }
  | { type: "enum"; enumName: string; valueName: string; value: number }
  | { type: "container"; elements: XppValue[] }
  | { type: "null" }
  | { type: "buffer"; buffer: TableBuffer }
  | { type: "object"; instance: ObjectInstance }
  | { type: "collection"; collection: XppCollection };

/**
 * A table buffer — a first-class value, not a row object. It carries whether it was
 * selected `forupdate`, because writing through a read-only buffer is a real error the
 * learner needs to meet.
 */
export interface TableBuffer {
  tableName: string;
  /** `undefined` until something is selected into it. */
  row?: Row;
  selectedForUpdate: boolean;
  /** `RecId == 0` means "not found" in X++, and lessons test exactly that. */
  isEmpty: boolean;
  /** The company the buffer's row was read from, for `crosscompany` results. */
  company?: CompanyId;
}

export interface ObjectInstance {
  className: string;
  fields: Map<string, XppValue>;
}

export type XppCollection =
  | { kind: "List"; itemType: string; items: XppValue[] }
  | { kind: "Set"; itemType: string; items: XppValue[] }
  | { kind: "Map"; keyType: string; valueType: string; entries: [XppValue, XppValue][] };

// ---------------------------------------------------------------------------
// Infolog
// ---------------------------------------------------------------------------

/** The sink behind `info()`, `warning()` and `error()`. */
export interface Infolog {
  add(type: InfologType, message: string, line?: number): void;
  entries(): readonly InfologEntry[];
  clear(): void;
}

export function createInfolog(): Infolog {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface RunOptions {
  ast: SourceUnit;
  db: VirtualDb;
  aot?: VirtualAot;
  /** Company the run starts in. Defaults to the database's current company. */
  company?: CompanyId;
  /** Defaults to `EXECUTION_LIMITS.timeoutMs`. */
  timeoutMs?: number;
  /** Defaults to `EXECUTION_LIMITS.maxStatements`. */
  maxStatements?: number;
  /** Called after each statement. Return `false` to stop — backs the step debugger. */
  onStatement?: (line: number) => boolean | void;
}

export interface RunResult {
  /** `false` when `errors` is non-empty. Partial output is still returned. */
  ok: boolean;
  infolog: InfologEntry[];
  sqlTrace: SqlTraceEntry[];
  errors: XppError[];
  statementsExecuted: number;
  durationMs: number;
  /**
   * Set when the run ended with an open transaction. Real F&O treats this as a defect;
   * so do we, and we say so rather than quietly committing.
   */
  uncommittedTransactionDepth: number;
}

/**
 * Execute a parsed program against a virtual database.
 *
 * Callers are expected to snapshot before and restore after (see the runner contract in
 * docs/lesson-schema.md) — `run` does not manage that itself, because the sandbox
 * deliberately does not restore.
 */
export function run(_options: RunOptions): Promise<RunResult> {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Interpreter internals, exposed for tests and for the Phase 4 step debugger
// ---------------------------------------------------------------------------

export interface Scope {
  readonly parent?: Scope;
  declare(name: string, value: XppValue): void;
  get(name: string): XppValue | undefined;
  set(name: string, value: XppValue): boolean;
  has(name: string): boolean;
}

export interface Interpreter {
  readonly infolog: Infolog;
  readonly scope: Scope;
  readonly statementsExecuted: number;
  execute(ast: SourceUnit): Promise<RunResult>;
}

export function createInterpreter(_options: RunOptions): Interpreter {
  throw new Error("not implemented");
}
