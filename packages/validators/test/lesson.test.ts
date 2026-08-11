/**
 * Phase 5's acceptance criterion, as a test.
 *
 * "One lesson authored end to end with three tasks, passing and failing paths both
 * correct." Every task's own solution must pass its own validators, and each plausible
 * wrong answer must fail with the *specific* authored message that addresses it — not
 * merely fail.
 *
 * That second half is the one that matters. A validator set where every wrong answer
 * trips the same generic check is worse than useless: it tells the learner they are
 * wrong without telling them how, which is exactly the failure mode the authored-message
 * rule exists to prevent.
 *
 * The task definitions are the real ones, imported from the lesson. If an author breaks
 * a lesson, this fails in CI rather than in front of a learner.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runTask, verifyTask } from "../src/index";
import type { TaskDefinition } from "../src/index";
import { tasks } from "../../../content/tracks/xpp-for-nav-devs/02-buffers-and-select.mdx";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const lessonTasks = tasks as TaskDefinition[];
const taskById = (id: string): TaskDefinition => {
  const found = lessonTasks.find((task) => task.id === id);
  if (found === undefined) throw new Error(`No task with id ${id}`);
  return found;
};

describe("lesson shape", () => {
  it("has three tasks", () => {
    expect(lessonTasks).toHaveLength(3);
  });

  it.each(lessonTasks.map((task) => [task.id, task] as const))(
    "%s has three escalating hints",
    (_id, task) => {
      expect(task.hints).toHaveLength(3);
      for (const hint of task.hints) expect(hint.length).toBeGreaterThan(20);
    },
  );

  it.each(lessonTasks.map((task) => [task.id, task] as const))(
    "%s gives every validator an authored message",
    (_id, task) => {
      expect(task.validators.length).toBeGreaterThan(0);
      for (const validator of task.validators) {
        expect(validator.message.length).toBeGreaterThan(20);
        // The rule from docs/lesson-schema.md: authored, not generated.
        expect(validator.message).not.toMatch(/assertion failed/i);
      }
    },
  );

  it.each(lessonTasks.map((task) => [task.id, task] as const))(
    "%s ships a starter that is not already the solution",
    (_id, task) => {
      expect(task.starter).not.toBe(task.solution);
      expect(task.prompt.length).toBeGreaterThan(20);
    },
  );
});

describe("every solution passes its own validators", () => {
  it.each(lessonTasks.map((task) => [task.id, task] as const))("%s", async (id, task) => {
    const result = await verifyTask(task, db);

    expect(
      {
        id,
        passed: result.passed,
        failedOn: result.failure?.message ?? null,
        parseErrors: result.parseErrors.map((error) => error.message),
        runtimeErrors: result.runtimeErrors.map((error) => error.message),
      },
      "the authored solution must satisfy the authored validators",
    ).toEqual({ id, passed: true, failedOn: null, parseErrors: [], runtimeErrors: [] });
  });
});

describe("the starter code fails, so the task is not already done", () => {
  it.each(lessonTasks.map((task) => [task.id, task] as const))("%s", async (_id, task) => {
    const result = await runTask({ task, source: task.starter, db });
    expect(result.passed).toBe(false);
  });
});

/**
 * Each wrong answer is paired with the message a learner should see. `expect` is a
 * fragment of the authored message that specifically addresses that mistake.
 */
interface WrongAnswer {
  label: string;
  source: string;
  expect: string;
}

/**
 * What the learner actually reads back.
 *
 * Two things can speak. If the code fails at runtime the engine's own error wins, and
 * that is the right outcome: writing outside a transaction produces F&O's own message
 * with its own hint, which beats anything an author would write. A validator message
 * only appears when the code ran cleanly but did the wrong thing.
 */
function feedbackFor(result: {
  failure?: { message?: string };
  runtimeErrors: { message: string; hint?: string }[];
}): string {
  if (result.failure?.message !== undefined) return result.failure.message;
  return result.runtimeErrors.map((error) => `${error.message} ${error.hint ?? ""}`).join("\n");
}

describe("select-one-item: wrong answers get the right message", () => {
  const task = () => taskById("select-one-item");

  const wrong: WrongAnswer[] = [
    {
      label: "no select at all",
      source: `InventTable inventTable;\ninfo("F-100");`,
      expect: "no select statement",
    },
    {
      label: "select without firstonly",
      source: `InventTable inventTable;
select inventTable where inventTable.ItemId == "F-100";
info(inventTable.ItemName);`,
      expect: "fetches the whole result set",
    },
    {
      label: "selects but never logs the name",
      source: `InventTable inventTable;
select firstonly inventTable where inventTable.ItemId == "F-100";`,
      expect: "Nothing was logged with the item's name",
    },
    {
      // Gets the right answer on screen, the expensive way. The message has to name
      // *that* mistake rather than claiming there is no select at all.
      label: "loops the whole table instead of selecting one",
      source: `InventTable inventTable;
while select inventTable
{
    if (inventTable.ItemId == "F-100")
    {
        info(inventTable.ItemName);
    }
}`,
      expect: "walks the whole table",
    },
  ];

  it.each(wrong.map((entry) => [entry.label, entry] as const))("%s", async (_label, entry) => {
    const result = await runTask({ task: task(), source: entry.source, db });
    expect(result.passed).toBe(false);
    expect(feedbackFor(result)).toContain(entry.expect);
  });
});

describe("loop-furniture: wrong answers get the right message", () => {
  const task = () => taskById("loop-furniture");

  const wrong: WrongAnswer[] = [
    {
      label: "a single select instead of a loop",
      source: `InventTable inventTable;
int counter;
select firstonly inventTable where inventTable.ItemGroupId == "FURNITURE";
info(inventTable.ItemId);
info(strFmt("Found %1 items", 1));`,
      expect: "about while select",
    },
    {
      label: "loops but forgets the count line",
      source: `InventTable inventTable;
while select inventTable where inventTable.ItemGroupId == "FURNITURE"
{
    info(inventTable.ItemId);
}`,
      expect: "count line is missing",
    },
    {
      label: "counts the wrong group",
      source: `InventTable inventTable;
int counter;
while select inventTable where inventTable.ItemGroupId == "RAWMAT"
{
    info(inventTable.ItemId);
    counter++;
}
info(strFmt("Found %1 items", counter));`,
      expect: "F-100 was not logged",
    },
  ];

  it.each(wrong.map((entry) => [entry.label, entry] as const))("%s", async (_label, entry) => {
    const result = await runTask({ task: task(), source: entry.source, db });
    expect(result.passed).toBe(false);
    expect(feedbackFor(result)).toContain(entry.expect);
  });
});

describe("block-furniture: wrong answers get the right message", () => {
  const task = () => taskById("block-furniture");

  const wrong: WrongAnswer[] = [
    {
      label: "forgets forupdate",
      source: `InventTable inventTable;
int counter;
ttsbegin;
while select inventTable where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    counter++;
}
ttscommit;
info(strFmt("Blocked %1 items", counter));`,
      expect: "read-only",
    },
    {
      // Everything right except the transaction — including the update() call, so this
      // isolates the one mistake it is named for.
      label: "forgets the transaction",
      source: `InventTable inventTable;
int counter;
while select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
info(strFmt("Blocked %1 items", counter));`,
      // The runtime answers this one, not the validator — see feedbackFor above.
      expect: "not allowed outside a transaction scope",
    },
    {
      label: "sets the field but never calls update",
      source: `InventTable inventTable;
int counter;
ttsbegin;
while select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    counter++;
}
ttscommit;
info(strFmt("Blocked %1 items", counter));`,
      expect: "only changes the buffer in memory",
    },
    {
      label: "blocks everything, not just FURNITURE",
      source: `InventTable inventTable;
int counter;
ttsbegin;
while select forupdate inventTable
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
ttscommit;
info(strFmt("Blocked %1 items", counter));`,
      expect: "outside the FURNITURE group",
    },
    {
      label: "does the work but never logs the count",
      source: `InventTable inventTable;
ttsbegin;
while select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
}
ttscommit;`,
      expect: "count is wrong",
    },
  ];

  it.each(wrong.map((entry) => [entry.label, entry] as const))("%s", async (_label, entry) => {
    const result = await runTask({ task: task(), source: entry.source, db });
    expect(result.passed).toBe(false);
    expect(feedbackFor(result)).toContain(entry.expect);
  });
});

describe("the runner contract", () => {
  it("runs no validators when the code does not parse", async () => {
    const result = await runTask({
      task: taskById("select-one-item"),
      source: "InventTable inventTable\nselect firstonly",
      db,
    });

    expect(result.passed).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.outcomes).toEqual([]);
  });

  it("surfaces only the first failure, not a wall of red", async () => {
    // This trips several validators at once; the learner should see one.
    const result = await runTask({
      task: taskById("block-furniture"),
      source: `InventTable inventTable;\ninfo("nothing useful");`,
      db,
    });

    expect(result.passed).toBe(false);
    expect(result.outcomes.filter((outcome) => !outcome.passed)).toHaveLength(1);
  });

  it("restores the database afterwards, so attempt two starts where attempt one did", async () => {
    const before = await db.readRows("InventTable");

    await runTask({
      task: taskById("block-furniture"),
      source: taskById("block-furniture").solution,
      db,
    });

    const after = await db.readRows("InventTable");
    expect(after).toEqual(before);
  });

  it("restores the database even when the code fails at runtime", async () => {
    const before = await db.readRows("InventTable");

    await runTask({
      task: taskById("block-furniture"),
      source: `InventTable inventTable;
ttsbegin;
delete_from inventTable;
info(strFmt("%1", 1 div 0));`,
      db,
    });

    expect(await db.readRows("InventTable")).toEqual(before);
  });

  it("reports a runtime error rather than an authored message", async () => {
    const result = await runTask({
      task: taskById("select-one-item"),
      source: `InventTable inventTable;\ninfo(strFmt("%1", 1 div 0));`,
      db,
    });

    expect(result.passed).toBe(false);
    expect(result.runtimeErrors[0]?.message).toContain("Division by zero");
    expect(result.failure).toBeUndefined();
  });
});
