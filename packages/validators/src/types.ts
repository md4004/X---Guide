/**
 * The validator contract from docs/lesson-schema.md.
 *
 * One rule shapes the whole API: **every validator carries an authored failure
 * message**. It is a required field, not an optional one, because a generated message
 * ("Assertion failed: usesModifier forupdate") teaches nothing. If you cannot write a
 * good message for a validator, it is the wrong validator.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { NodeKind, SelectModifier } from "@xpplab/xpp-parser";
import type { TableName } from "@xpplab/virtual-db";
import type { ODataRequest } from "@xpplab/renderers";

interface ValidatorBase {
  /**
   * Learner-facing text shown when this validator fails. Authored, never generated.
   * Bad: "Assertion failed: usesModifier forupdate."
   * Good: "Your loop reads the records but can't write to them — a buffer selected
   * without `forupdate` is read-only."
   */
  message: string;
}

export type AstValidator = ValidatorBase &
  (
    | { kind: "ast"; rule: "usesStatement"; value: NodeKind }
    | { kind: "ast"; rule: "usesModifier"; value: SelectModifier }
    /**
     * No select in the program carries this modifier. The counterpart to `usesModifier`,
     * and `forbids` cannot stand in for it — that rule takes a node kind, and a modifier
     * is not a node. Written for `crosscompany`, where reaching across companies is a
     * correctness bug rather than a style one.
     */
    | { kind: "ast"; rule: "forbidsModifier"; value: SelectModifier }
    | { kind: "ast"; rule: "wrappedIn"; value: "transaction" }
    | { kind: "ast"; rule: "callsMethod"; value: string }
    | { kind: "ast"; rule: "forbids"; value: NodeKind }
    | { kind: "ast"; rule: "declaresExtension"; value: string }
  );

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

export type OutputValidator = ValidatorBase & {
  kind: "output";
  /** A regex source string, e.g. `"^Blocked \\d+ items$"`. Anchored as written. */
  match: string;
  type?: "info" | "warning" | "error";
  /** `true` fails when the pattern *does* match. For "don't log the whole table". */
  negate?: boolean;
};

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
    | { kind: "sql"; rule: "matches"; value: string }
    | { kind: "sql"; rule: "forbids"; value: string }
  );

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

export type ODataValidator = ValidatorBase & {
  kind: "odata";
  request: ODataRequest;
  expectStatus: number;
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
