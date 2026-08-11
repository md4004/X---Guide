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
