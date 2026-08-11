/**
 * Every lesson in the track, verified.
 *
 * This is Phase 5's acceptance criterion generalised to Phase 6's content. It imports
 * the real registry — the same one the site serves — so a lesson cannot ship without
 * passing here. Three things are checked for every task in every lesson:
 *
 *   1. the authored solution passes the authored validators
 *   2. the starter code fails, so no task is already done
 *   3. the shape rules from the authoring checklist hold
 *
 * Per-lesson wrong answers live in `wrong-answers.test.ts`, where each mistake is paired
 * with the specific message it should produce. That file is the one that catches
 * validator ordering bugs; this one catches "the lesson is broken".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runTask, verifyTask } from "../src/index";
import type { TaskDefinition } from "../src/index";
import { allTasks, lessonList } from "./lessons";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

describe("track", () => {
  it("has every lesson its track.json lists", () => {
    expect(lessonList().length).toBeGreaterThan(0);
  });

  it("gives every task a unique id across the whole track", () => {
    const ids = allTasks().map(([, task]) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("authoring checklist", () => {
  const entries = allTasks();

  it.each(entries)("%s has three escalating hints", (_label, task) => {
    expect(task.hints).toHaveLength(3);
    for (const hint of task.hints) expect(hint.length).toBeGreaterThan(20);
  });

  it.each(entries)("%s gives every validator an authored message", (_label, task) => {
    expect(task.validators.length).toBeGreaterThan(0);
    for (const validator of task.validators) {
      expect(validator.message.length).toBeGreaterThan(20);
      // The rule from docs/lesson-schema.md: authored, not generated.
      expect(validator.message).not.toMatch(/assertion failed/i);
    }
  });

  it.each(entries)("%s has a starter that is not the solution", (_label, task) => {
    expect(task.starter).not.toBe(task.solution);
    expect(task.prompt.length).toBeGreaterThan(20);
  });

  it.each(lessonList())("%s has two to four tasks", (_slug, lesson) => {
    expect(lesson.tasks.length).toBeGreaterThanOrEqual(2);
    expect(lesson.tasks.length).toBeLessThanOrEqual(4);
  });

  it.each(lessonList())("%s declares objectives and a length", (_slug, lesson) => {
    expect(lesson.frontmatter.objectives.length).toBeGreaterThanOrEqual(2);
    expect(lesson.frontmatter.minutes).toBeGreaterThan(0);
    expect(lesson.frontmatter.title.length).toBeGreaterThan(3);
  });

  it.each(lessonList())("%s only requires engine capabilities that exist", (_slug, lesson) => {
    // A lesson that needs the AOT or the form renderer must not ship before they do.
    for (const capability of lesson.frontmatter.requiresEngine) {
      expect(["db", "runtime"]).toContain(capability);
    }
  });
});

describe("every solution passes its own validators", () => {
  it.each(allTasks())("%s", async (label, task) => {
    const result = await verifyTask(task as TaskDefinition, db);

    expect(
      {
        task: label,
        passed: result.passed,
        failedOn: result.failure?.message ?? null,
        parseErrors: result.parseErrors.map((error) => `line ${error.line}: ${error.message}`),
        runtimeErrors: result.runtimeErrors.map((error) => error.message),
      },
      "the authored solution must satisfy the authored validators",
    ).toEqual({
      task: label,
      passed: true,
      failedOn: null,
      parseErrors: [],
      runtimeErrors: [],
    });
  });
});

describe("the starter code fails, so no task is already done", () => {
  it.each(allTasks())("%s", async (_label, task) => {
    const result = await runTask({ task: task as TaskDefinition, source: task.starter, db });
    expect(result.passed).toBe(false);
  });
});

describe("the runner contract", () => {
  const first = () => allTasks()[0]![1] as TaskDefinition;

  it("runs no validators when the code does not parse", async () => {
    const result = await runTask({ task: first(), source: "int counter = ;", db });

    expect(result.passed).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.outcomes).toEqual([]);
  });

  it("surfaces only the first failure, not a wall of red", async () => {
    const result = await runTask({ task: first(), source: 'info("nothing useful");', db });

    expect(result.passed).toBe(false);
    expect(result.outcomes.filter((outcome) => !outcome.passed)).toHaveLength(1);
  });

  it("restores the database after every task's solution", async () => {
    const before = await db.readRows("InventTable", { company: "all" });

    for (const [, task] of allTasks()) {
      await verifyTask(task as TaskDefinition, db);
    }

    expect(await db.readRows("InventTable", { company: "all" })).toEqual(before);
  });

  it("restores the database even when the code fails at runtime", async () => {
    const before = await db.readRows("InventTable");

    await runTask({
      task: first(),
      source: `InventTable inventTable;
ttsbegin;
delete_from inventTable;
info(strFmt("%1", 1 div 0));`,
      db,
    });

    expect(await db.readRows("InventTable")).toEqual(before);
  });
});
