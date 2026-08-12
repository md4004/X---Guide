/**
 * The message contract between the playground and the engine worker.
 *
 * Shared by both sides so a change to one is a type error in the other.
 */

import type { InfologEntry, SqlTraceEntry, XppError } from "@xpplab/xpp-core";
import type { Row, TableName } from "@xpplab/virtual-db";
import type { StepView, TaskDefinition } from "@xpplab/validators";
import type { FormViewModel, ReportViewModel } from "@xpplab/renderers";
import type { Breakpoint, DebugCommand, DebugPause } from "@xpplab/xpp-runtime";

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
  /**
   * Built by the worker while the run's changes are still in the database — the task
   * runner restores its snapshot immediately afterwards, so the main thread has no window
   * in which to read them.
   */
  view?: StepView;
}

/**
 * Runs a reading step's example.
 *
 * No validators and no verdict — just the Infolog, the SQL trace and whatever viewer the
 * step declared. Snapshotted and restored like a task, because an example is for looking
 * at: it must not leave the lesson's data changed for the exercise that follows.
 */
export interface PreviewRequest {
  id: number;
  kind: "preview";
  source: string;
  view?: StepView;
}

/**
 * Starts a debugged run — the Studio's **Start Debugging** (F5).
 *
 * Unlike every other request this one is not a single round trip. The worker replies with
 * `DebugPausedEvent` each time execution stops, waits for a `DebugCommandMessage`, and
 * only sends the ordinary `EngineReply` when the run finishes or is stopped.
 */
export interface DebugRequest {
  id: number;
  kind: "debug";
  source: string;
  company: string;
  breakpoints: Breakpoint[];
  /** Names the outermost call-stack frame — the project's startup object. */
  entryPoint?: string;
  tables: TableName[];
}

export type EngineRequest =
  RunRequest | ResetRequest | ReadRequest | TaskRequest | PreviewRequest | DebugRequest;

/**
 * Resumes a paused run.
 *
 * Carries the breakpoint list as well as the command, so a breakpoint added or removed
 * while execution is paused takes effect on resume — which is what the real debugger does,
 * and is the only way "set a breakpoint further down and press F5" can work.
 */
export interface DebugCommandMessage {
  kind: "debugCommand";
  command: DebugCommand;
  breakpoints: Breakpoint[];
}

/** Sent by the worker every time a debugged run stops. */
export interface DebugPausedEvent {
  id: number;
  kind: "paused";
  pause: DebugPause;
}

/** Everything the main thread can post to the worker. */
export type EngineMessage = EngineRequest | DebugCommandMessage;

/** Everything the worker can post back. */
export type EngineOutbound = EngineReply | DebugPausedEvent;

/**
 * What a lesson task reports back.
 *
 * Deliberately one `message`, not a list. Which message depends on how far the code
 * got — parse, runtime, or validator — and the UI picks accordingly.
 */
export interface TaskOutcome {
  passed: boolean;
  /** `true` for a reading step's example: it ran, but nothing judged it. */
  preview?: boolean;
  /** The authored message for the first validator that failed. */
  message?: string;
  parseErrors?: XppError[];
  runtimeErrors?: XppError[];
  infolog?: InfologEntry[];
  sqlTrace?: SqlTraceEntry[];
  /** Set when the pass was read from localStorage rather than just earned. */
  restored?: boolean;
  /** Present when the step declared a `view`, and it built. */
  form?: FormViewModel;
  report?: ReportViewModel;
  /** Why the view could not be built, when it could not. */
  viewError?: string;
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
    /** Set when the run ended because the learner pressed Stop Debugging. */
    stoppedByDebugger?: boolean;
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
