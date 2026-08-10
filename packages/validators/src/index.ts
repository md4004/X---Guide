/**
 * @xpplab/validators — task assertion runners.
 *
 * Implements the validator contract in docs/lesson-schema.md. Lesson authors write
 * these declaratively at the bottom of an MDX file and never touch engine code.
 *
 * One rule shapes the whole API: **every validator carries an authored failure
 * message**. It is a required field, not an optional one, because a generated message
 * ("Assertion failed: usesModifier forupdate") teaches nothing. If you cannot write a
 * good message for a validator, it is the wrong validator.
 */

import type { SqlValue, XppError } from "@xpplab/xpp-core";
import type { NodeKind, SourceUnit, SelectModifier } from "@xpplab/xpp-parser";
import type { RunResult } from "@xpplab/xpp-runtime";
import type { TableName, VirtualDb } from "@xpplab/virtual-db";
import type { VirtualAot } from "@xpplab/virtual-aot";
import type { ODataRequest, ODataResponse } from "@xpplab/renderers";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

interface ValidatorBase {
  /**
   * Learner-facing text shown when this validator fails. Authored, never generated.
   * Bad: "Assertion failed: usesModifier forupdate."
   * Good: "Your loop reads the records but can't write to them — a buffer selected
   * without `forupdate` is read-only."
   */
  message: string;
}

// ---------------------------------------------------------------------------
// ast
// ---------------------------------------------------------------------------

/**
 * Structural assertions on the learner's parse tree. These prove *how* they solved it,
 * not just that the numbers came out right.
 */
export type AstValidator = ValidatorBase &
  (
    | { kind: "ast"; rule: "usesStatement"; value: NodeKind }
    | { kind: "ast"; rule: "usesModifier"; value: SelectModifier }
    | { kind: "ast"; rule: "wrappedIn"; value: "transaction" }
    | { kind: "ast"; rule: "callsMethod"; value: string }
    | { kind: "ast"; rule: "forbids"; value: NodeKind }
    | { kind: "ast"; rule: "declaresExtension"; value: string }
  );

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/** Assertions on the virtual DB after the run. */
export type StateValidator = ValidatorBase & {
  kind: "state";
  table: TableName;
  /** Field/value pairs narrowing which rows are checked. Omit to check every row. */
  where?: Record<string, SqlValue>;
  /**
   * `true` requires every matching row to satisfy `expect`; `false` requires at least
   * one. Defaults to `true` — the stricter reading is almost always the intended one.
   */
  all?: boolean;
  /** Company to check in. `"all"` ignores `DATAAREAID`. Defaults to the run's company. */
  company?: string | "all";
} & ({ expect: Record<string, SqlValue>; count?: never } | { count: number; expect?: never });

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

/** Regex against Infolog entries, filtered by type. */
export type OutputValidator = ValidatorBase & {
  kind: "output";
  /** A regex source string, e.g. `"^Blocked \\d+ items$"`. Anchored as written. */
  match: string;
  type?: "info" | "warning" | "error";
  /** `true` fails when the pattern *does* match. For "don't log the whole table". */
  negate?: boolean;
};

// ---------------------------------------------------------------------------
// sql
// ---------------------------------------------------------------------------

/**
 * Assertions on the generated SQL trace. `maxStatements` is how you force set-based
 * solutions: a row-by-row loop passes the state check and fails this one, and the
 * learner sees exactly why in the trace panel.
 *
 * This is the single highest-value validator on the site. Use it deliberately.
 */
export type SqlValidator = ValidatorBase &
  (
    | { kind: "sql"; rule: "maxStatements"; value: number }
    | { kind: "sql"; rule: "minStatements"; value: number }
    /** Fails unless some statement in the trace matches this regex source. */
    | { kind: "sql"; rule: "matches"; value: string }
    /** Fails if any statement matches — e.g. forbid a correlated per-row select. */
    | { kind: "sql"; rule: "forbids"; value: string }
  );

// ---------------------------------------------------------------------------
// metadata (Phase 7+)
// ---------------------------------------------------------------------------

export type MetadataValidator = ValidatorBase &
  (
    | { kind: "metadata"; rule: "fieldExists"; table: string; field: string }
    | { kind: "metadata"; rule: "fieldUsesEdt"; table: string; field: string; edt: string }
    | {
        kind: "metadata";
        rule: "propertyEquals";
        object: string;
        property: string;
        value: string | number | boolean;
      }
    | { kind: "metadata"; rule: "relationExists"; table: string; relatedTable: string }
  );

// ---------------------------------------------------------------------------
// odata (Phase 10+)
// ---------------------------------------------------------------------------

export type ODataValidator = ValidatorBase & {
  kind: "odata";
  request: ODataRequest;
  expectStatus: number;
  /** Subset match against the response body — only the listed paths are compared. */
  expectBody?: Record<string, unknown>;
};

export type Validator =
  | AstValidator
  | StateValidator
  | OutputValidator
  | SqlValidator
  | MetadataValidator
  | ODataValidator;

export type ValidatorKind = Validator["kind"];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** One interactive task, as authored in a lesson's `tasks` export. */
export interface TaskDefinition {
  id: string;
  prompt: string;
  starter: string;
  solution: string;
  /** Exactly three, escalating from nudge to near-solution. */
  hints: string[];
  /** Run in declaration order. Order them cheapest-and-most-diagnostic first. */
  validators: Validator[];
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface ValidationContext {
  /** `null` when the source failed to parse — no validator runs in that case. */
  ast: SourceUnit | null;
  run: RunResult;
  db: VirtualDb;
  aot?: VirtualAot;
  /** Populated only when the task declared `odata` validators. */
  odata?: (request: ODataRequest) => Promise<ODataResponse>;
}

export interface ValidatorOutcome {
  validator: Validator;
  passed: boolean;
  /** The authored `message`, on failure. */
  message?: string;
  /**
   * Machine-readable detail for the UI to render alongside the message — the actual
   * statement count, the offending row, the Infolog line that nearly matched.
   */
  detail?: Record<string, unknown>;
}

export interface TaskResult {
  passed: boolean;
  /**
   * The first failure, and only the first. A wall of red teaches nothing — see the
   * runner contract in docs/lesson-schema.md.
   */
  failure?: ValidatorOutcome;
  /** Everything that ran, in order, for the author-facing debug view. */
  outcomes: ValidatorOutcome[];
  /** Parse errors, when the source never made it to execution. */
  parseErrors: XppError[];
}

/** Run a task's validators in declaration order, stopping at the first failure. */
export function runValidators(
  _validators: Validator[],
  _context: ValidationContext,
): Promise<TaskResult> {
  throw new Error("not implemented");
}

/**
 * Author-time check: does this task's own `solution` pass its own validators?
 * Wired into the test suite so a broken lesson fails CI rather than a learner.
 */
export function verifyTask(
  _task: TaskDefinition,
  _context: ValidationContext,
): Promise<TaskResult> {
  throw new Error("not implemented");
}
