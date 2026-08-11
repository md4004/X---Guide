/**
 * The task runner.
 *
 * Implements the runner contract from docs/lesson-schema.md:
 *
 *   1. Snapshot the virtual environment for the lesson's seed.
 *   2. Parse learner code. Parse failure → return errors, run no validators.
 *   3. Execute with a 3-second ceiling and a 100k-statement cap.
 *   4. Run validators in declaration order. Stop at the first failure and surface only
 *      that one — a wall of red teaches nothing.
 *   5. Restore the snapshot.
 *
 * Step 5 is in a `finally`. A task that throws must not leave the next attempt starting
 * from a half-mutated database, or the learner's second try fails for reasons invisible
 * to them.
 */

import type { XppError } from "@xpplab/xpp-core";
import { parse, type SourceUnit } from "@xpplab/xpp-parser";
import type { VirtualDb } from "@xpplab/virtual-db";
import { runSource, type RunSourceResult } from "@xpplab/xpp-runtime";
import { describeAstFailure, evaluateAst } from "./ast";
import { evaluateOutput, evaluateSql, evaluateState, type AssertionResult } from "./assertions";
import type { TaskDefinition, Validator } from "./types";

export interface ValidationContext {
  /** `null` when the source failed to parse — no validator runs in that case. */
  ast: SourceUnit | null;
  run: RunSourceResult;
  db: VirtualDb;
}

export interface ValidatorOutcome {
  validator: Validator;
  passed: boolean;
  /** The authored `message`, on failure. */
  message?: string;
  /** Machine-readable detail for the UI and the author-facing debug view. */
  detail?: Record<string, unknown>;
}

export interface TaskResult {
  passed: boolean;
  /** The first failure, and only the first. */
  failure?: ValidatorOutcome;
  /** Everything that ran, in order. */
  outcomes: ValidatorOutcome[];
  /** Parse errors, when the source never made it to execution. */
  parseErrors: XppError[];
  /** Runtime errors. A task fails if the code did not finish cleanly. */
  runtimeErrors: XppError[];
  run?: RunSourceResult;
}

/** Run one validator. Kinds not yet implemented say so rather than silently passing. */
async function evaluate(
  validator: Validator,
  context: ValidationContext,
): Promise<AssertionResult> {
  switch (validator.kind) {
    case "ast": {
      if (context.ast === null) return { passed: false, detail: { reason: "no parse tree" } };
      return {
        passed: evaluateAst(validator, context.ast),
        detail: describeAstFailure(validator, context.ast),
      };
    }

    case "state":
      return evaluateState(validator, context.db);

    case "output":
      return evaluateOutput(validator, context.run.infolog);

    case "sql":
      return evaluateSql(validator, context.run.sqlTrace);

    case "metadata":
    case "odata":
      // Phase 7 and Phase 10. Failing loudly beats passing a check nothing performed —
      // a lesson that silently validates nothing is worse than one that will not load.
      return {
        passed: false,
        detail: {
          authoringError: `\`${validator.kind}\` validators are not available yet. Remove it, or gate the lesson with requiresEngine.`,
        },
      };
  }
}

/** Runs validators in declaration order, stopping at the first failure. */
export async function runValidators(
  validators: Validator[],
  context: ValidationContext,
): Promise<TaskResult> {
  const outcomes: ValidatorOutcome[] = [];

  for (const validator of validators) {
    const result = await evaluate(validator, context);
    const outcome: ValidatorOutcome = {
      validator,
      passed: result.passed,
      detail: result.detail,
      ...(result.passed ? {} : { message: validator.message }),
    };
    outcomes.push(outcome);

    if (!result.passed) {
      return {
        passed: false,
        failure: outcome,
        outcomes,
        parseErrors: [],
        runtimeErrors: context.run.errors,
        run: context.run,
      };
    }
  }

  return {
    passed: true,
    outcomes,
    parseErrors: [],
    runtimeErrors: context.run.errors,
    run: context.run,
  };
}

export interface RunTaskOptions {
  task: TaskDefinition;
  source: string;
  db: VirtualDb;
  /** Fixed date so a task's expectations do not drift with the calendar. */
  today?: string;
}

/**
 * The whole contract, end to end: snapshot, parse, run, validate, restore.
 *
 * This is what a lesson calls. `runValidators` is exposed separately only so the
 * assertion layer can be tested without a database round trip.
 */
export async function runTask(options: RunTaskOptions): Promise<TaskResult> {
  const { task, source, db } = options;
  const snapshot = await db.snapshot();

  try {
    const run = await runSource({
      source,
      db,
      ...(options.today === undefined ? {} : { today: options.today }),
    });

    // Step 2: a parse failure means no validator runs. Executing a half-understood tree
    // would pile confusing state changes on top of an already-confusing error.
    if (run.parseFailed) {
      return {
        passed: false,
        outcomes: [],
        parseErrors: run.errors,
        runtimeErrors: [],
        run,
      };
    }

    // A runtime error means the code did not do what it claimed, whatever the rows say.
    // Reporting the engine's own error is more useful than any authored message here.
    if (run.errors.length > 0) {
      return {
        passed: false,
        outcomes: [],
        parseErrors: [],
        runtimeErrors: run.errors,
        run,
      };
    }

    // Parsed a second time purely to hand the tree to `ast` validators. `runSource` does
    // not return its AST, and threading one out would widen the runtime's public surface
    // for exactly one caller. A lesson-sized snippet parses in well under a millisecond.
    const { ast } = parse(source);
    return await runValidators(task.validators, { ast, run, db });
  } finally {
    await db.restore(snapshot);
  }
}

/**
 * Author-time check: does a task's own `solution` pass its own validators?
 *
 * Wired into the test suite so a broken lesson fails CI rather than a learner.
 */
export async function verifyTask(
  task: TaskDefinition,
  db: VirtualDb,
  today?: string,
): Promise<TaskResult> {
  return runTask({
    task,
    source: task.solution,
    db,
    ...(today === undefined ? {} : { today }),
  });
}
