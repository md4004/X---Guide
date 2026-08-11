/**
 * The message contract between the playground and the engine worker.
 *
 * Shared by both sides so a change to one is a type error in the other.
 */

import type { InfologEntry, SqlTraceEntry, XppError } from "@xpplab/xpp-core";
import type { Row, TableName } from "@xpplab/virtual-db";
import type { TaskDefinition } from "@xpplab/validators";

export interface RunRequest {
  id: number;
  kind: "run";
  source: string;
  company: string;
  /** Tables to read back for the Data panel. */
  tables: TableName[];
}

export interface ResetRequest {
  id: number;
  kind: "reset";
  seed?: string;
  tables: TableName[];
}

export interface ReadRequest {
  id: number;
  kind: "read";
  tables: TableName[];
  company: string;
}

export interface TaskRequest {
  id: number;
  kind: "task";
  /** The whole task, so the worker needs no content of its own. */
  task: TaskDefinition;
  source: string;
}

export type EngineRequest = RunRequest | ResetRequest | ReadRequest | TaskRequest;

/**
 * What a lesson task reports back.
 *
 * Deliberately one `message`, not a list. Which message depends on how far the code
 * got — parse, runtime, or validator — and the UI picks accordingly.
 */
export interface TaskOutcome {
  passed: boolean;
  /** The authored message for the first validator that failed. */
  message?: string;
  parseErrors?: XppError[];
  runtimeErrors?: XppError[];
  infolog?: InfologEntry[];
  sqlTrace?: SqlTraceEntry[];
  /** Set when the pass was read from localStorage rather than just earned. */
  restored?: boolean;
}

export interface TableSnapshot {
  table: TableName;
  columns: string[];
  rows: Row[];
  /**
   * RECIDs this run inserted or changed. The Data panel highlights them, which is how a
   * learner sees *what* their code did rather than only that it did something.
   */
  changedRecIds: number[];
}

export interface EngineReply {
  id: number;
  ok: boolean;
  /** Present when `ok` is false and the worker itself failed, not the learner's code. */
  error?: string;
  /** Set for `task` requests. */
  task?: TaskOutcome;
  result?: {
    infolog: InfologEntry[];
    sqlTrace: SqlTraceEntry[];
    errors: XppError[];
    statementsExecuted: number;
    durationMs: number;
    uncommittedTransactionDepth: number;
    parseFailed: boolean;
    tables: TableSnapshot[];
    companies: string[];
    company: string;
  };
}

/** Tables the Data panel shows. Deliberately the ones the lessons touch. */
export const PANEL_TABLES: TableName[] = [
  "CustTable",
  "InventTable",
  "SalesTable",
  "SalesLine",
  "CustTrans",
  "InventSum",
];
