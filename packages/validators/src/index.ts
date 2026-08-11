/**
 * @xpplab/validators — task assertion runners.
 *
 * Implements the validator contract in docs/lesson-schema.md. Lesson authors write these
 * declaratively at the bottom of an MDX file and never touch engine code.
 */

export type {
  AstValidator,
  StateValidator,
  OutputValidator,
  SqlValidator,
  MetadataValidator,
  ODataValidator,
  Validator,
  ValidatorKind,
  TaskDefinition,
} from "./types";

export { runTask, runValidators, verifyTask } from "./runner";
export type { RunTaskOptions, TaskResult, ValidationContext, ValidatorOutcome } from "./runner";

export { evaluateAst } from "./ast";
export { evaluateOutput, evaluateSql, evaluateState } from "./assertions";
export type { AssertionResult } from "./assertions";

// ---------------------------------------------------------------------------
// Lesson content
// ---------------------------------------------------------------------------

/** Engine capabilities a lesson can require, gating it from publishing too early. */
export type EngineCapability = "db" | "runtime" | "aot" | "forms" | "classes" | "reports" | "odata";

export interface LessonFrontmatter {
  slug: string;
  title: string;
  minutes: number;
  objectives: string[];
  requiresEngine: EngineCapability[];
  /** A named seed variant in virtual-db. Defaults to `default`. */
  seed?: string;
}

/**
 * One step of a lesson.
 *
 * A lesson is a sequence of these rather than one long page: the learner reads the
 * instructions on the right, writes code on the left, and moves on. A step with no
 * `taskId` is a reading step — it explains something and the editor holds an example to
 * play with.
 */
export interface LessonStep {
  id: string;
  /** Shown in the step header and in the progress rail. */
  title: string;
  /** The task the learner must pass before this step is complete. */
  taskId?: string;
  /**
   * Code to put in the editor for a reading step, so there is always something to run.
   * Ignored when `taskId` is set — the task's `starter` wins.
   */
  example?: string;
  /**
   * An extra viewer to show beside the result, for steps where the point is what the
   * code *produced* rather than what it logged.
   */
  view?: StepView;
}

/**
 * A rendered view of what a run left behind.
 *
 * `form` renders a form from AOT metadata over the current data. `report` groups and
 * totals the rows a data provider wrote into its table, the way a report design would.
 * Both are built inside the run window, before the task runner restores its snapshot.
 */
export type StepView =
  | { kind: "form"; form: string }
  | {
      kind: "report";
      /** The table the learner's data provider fills. */
      table: string;
      title: string;
      groupBy: string[];
      totals: { column: string; aggregate: "sum" | "count" | "avg" }[];
    };

export interface TrackDefinition {
  slug: string;
  title: string;
  summary: string;
  level: "beginner" | "intermediate" | "advanced";
  estimatedMinutes: number;
  lessons: string[];
  requiresEngine: EngineCapability[];
}

/** Capabilities the engine actually has today. Anything else gates a lesson out. */
export const AVAILABLE_CAPABILITIES: readonly EngineCapability[] = ["db", "runtime"];

export function lessonIsPublishable(frontmatter: LessonFrontmatter): boolean {
  return frontmatter.requiresEngine.every((capability) =>
    AVAILABLE_CAPABILITIES.includes(capability),
  );
}
