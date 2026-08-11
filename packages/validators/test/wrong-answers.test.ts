/**
 * Plausible wrong answers, each paired with the message it should produce.
 *
 * `lesson.test.ts` proves the solutions work. This file proves the *failures* work, which
 * is the harder and more valuable half: a validator set where every mistake trips the
 * same generic check tells a learner they are wrong without telling them how.
 *
 * Two authoring defects have been caught here so far, both invisible to a test that only
 * asserted "this fails":
 *   - solving lesson 2's first task with `while select` was reported as "there is no
 *     select statement", which sent the learner looking for the wrong thing
 *   - forgetting `update()` was reported as writing outside a transaction, because
 *     "every mutation is in a transaction" is vacuously false when there are none
 *
 * Both were fixed in the content — reordering validators, adding a specific one — with no
 * engine change, which is what the Phase 5 criterion was asking for.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runTask } from "../src/index";
import type { TaskDefinition, TaskResult } from "../src/index";
import { lessonList } from "./lessons";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

function taskFor(lessonSlug: string, taskId: string): TaskDefinition {
  const lesson = lessonList().find(([slug]) => slug === lessonSlug)?.[1];
  const task = lesson?.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) throw new Error(`No task ${lessonSlug}/${taskId}`);
  return task;
}

/**
 * What the learner actually reads back.
 *
 * Two things can speak. If the code fails at runtime the engine's own error wins, and
 * that is right: writing outside a transaction produces F&O's own message with its own
 * hint, which beats anything an author would write. A validator message only appears
 * when the code ran cleanly but did the wrong thing.
 */
function feedbackFor(result: TaskResult): string {
  if (result.failure?.message !== undefined) return result.failure.message;
  return result.runtimeErrors.map((error) => `${error.message} ${error.hint ?? ""}`).join("\n");
}

interface WrongAnswer {
  lesson: string;
  task: string;
  label: string;
  source: string;
  /** A fragment of the message that specifically addresses this mistake. */
  expect: string;
}

const WRONG: WrongAnswer[] = [
  // -- 01 Hello Infolog ----------------------------------------------------
  {
    lesson: "01-hello-infolog",
    task: "three-levels",
    label: "uses info for all three levels",
    source: 'info("Starting");\ninfo("Careful");\ninfo("Stopped");',
    expect: "warning() is its own function",
  },
  {
    lesson: "01-hello-infolog",
    task: "format-a-message",
    label: "concatenates instead of using strFmt",
    source:
      'str company = "Havensdale";\nint itemCount = 4;\ninfo(company + " has " + int2Str(itemCount) + " items");',
    expect: "Build the message with strFmt",
  },
  {
    lesson: "01-hello-infolog",
    task: "format-a-message",
    label: "forgets the second argument",
    source:
      'str company = "Havensdale";\nint itemCount = 4;\ninfo(strFmt("%1 has %2 items", company));',
    expect: "leftover %2",
  },

  // -- 02 Buffers and select -----------------------------------------------
  {
    lesson: "02-buffers-and-select",
    task: "select-one-item",
    label: "loops the whole table instead of selecting one",
    source:
      'InventTable inventTable;\nwhile select inventTable\n{\n    if (inventTable.ItemId == "F-100")\n    {\n        info(inventTable.ItemName);\n    }\n}',
    expect: "walks the whole table",
  },
  {
    lesson: "02-buffers-and-select",
    task: "select-one-item",
    label: "omits firstonly",
    source:
      'InventTable inventTable;\nselect inventTable where inventTable.ItemId == "F-100";\ninfo(inventTable.ItemName);',
    expect: "fetches the whole result set",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "forgets forupdate",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "read-only",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "sets the field but never calls update",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "only changes the buffer in memory",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "blocks every group, not just FURNITURE",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select forupdate inventTable\n{\n    inventTable.Blocked = NoYes::Yes;\n    inventTable.update();\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "outside the FURNITURE group",
  },

  // -- 03 Transactions -----------------------------------------------------
  {
    lesson: "03-transactions",
    task: "wrap-a-write",
    label: "writes with no transaction at all",
    source:
      'CustTable custTable;\nselect forupdate custTable where custTable.AccountNum == "C-1000";\ncustTable.CreditMax = 75000;\ncustTable.update();\ninfo("Credit limit updated");',
    expect: "not allowed outside a transaction scope",
  },
  {
    lesson: "03-transactions",
    task: "abort-discards-everything",
    label: "commits the inner level instead of aborting",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\ninventTable.ItemId = "F-800";\ninventTable.ItemName = "Outer";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\nttsbegin;\ninventTable.clear();\ninventTable.ItemId = "F-801";\ninventTable.ItemName = "Inner";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\nttscommit;\nttscommit;\nwhile select inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    counter++;\n}\ninfo(strFmt("Survived: %1", counter));',
    expect: "This task is about ttsabort",
  },

  // -- 04 Insert, update, delete -------------------------------------------
  {
    lesson: "04-insert-update-delete",
    task: "two-inserts-and-clear",
    label: "forgets clear() between the inserts",
    source:
      'InventTable inventTable;\nttsbegin;\ninventTable.ItemId = "F-600";\ninventTable.ItemName = "First";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\ninventTable.ItemId = "F-601";\ninventTable.ItemName = "Second";\ninventTable.insert();\nttscommit;\ninfo("Inserted two items");',
    expect: "no call to clear()",
  },
  {
    lesson: "04-insert-update-delete",
    task: "update-a-record",
    label: "reads without forupdate",
    source:
      'InventTable inventTable;\nttsbegin;\nselect inventTable where inventTable.ItemId == "F-100";\ninventTable.ItemName = "Ashwood desk 1400 (refreshed)";\ninventTable.Blocked = NoYes::Yes;\ninventTable.update();\nttscommit;\ninfo("Updated F-100");',
    // The runtime answers this one before any validator runs, and its message is better.
    expect: "not selected for update",
  },

  // -- 05 Joins ------------------------------------------------------------
  {
    lesson: "05-joins",
    task: "join-orders-and-lines",
    label: "nests a select inside the loop, the C/AL way",
    source:
      'SalesTable salesTable;\nSalesLine salesLine;\nint counter;\nwhile select salesTable\n{\n    while select salesLine where salesLine.SalesId == salesTable.SalesId\n    {\n        info(strFmt("%1 / %2", salesTable.SalesId, salesLine.ItemId));\n        counter++;\n    }\n}\ninfo(strFmt("%1 lines", counter));',
    expect: "ran more than one query",
  },
  {
    lesson: "05-joins",
    task: "customers-with-orders",
    label: "uses a plain join, so customers repeat",
    source:
      'CustTable custTable;\nSalesTable salesTable;\nint counter;\nwhile select custTable\n    join salesTable\n    where salesTable.CustAccount == custTable.AccountNum\n{\n    info(custTable.AccountNum);\n    counter++;\n}\ninfo(strFmt("%1 customers with orders", counter));',
    expect: "no EXISTS in it",
  },

  // -- 06 Set-based --------------------------------------------------------
  {
    lesson: "06-set-based",
    task: "block-with-update-recordset",
    label: "right rows, wrong number of statements",
    source:
      'InventTable inventTable;\nttsbegin;\nwhile select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    inventTable.update();\n}\nttscommit;\ninfo("Blocked in one statement");',
    expect: "look at the SQL trace",
  },
  {
    lesson: "06-set-based",
    task: "delete-a-group",
    label: "deletes everything, not just COMPONENT",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\ndelete_from inventTable;\nttscommit;\nwhile select inventTable\n{\n    counter++;\n}\ninfo(strFmt("%1 items remain", counter));',
    expect: "FURNITURE items are gone too",
  },

  // -- 07 Companies --------------------------------------------------------
  {
    lesson: "07-companies",
    task: "count-in-another-company",
    label: "counts this company instead of KELT",
    source:
      'CustTable custTable;\nint counter;\nwhile select custTable\n{\n    counter++;\n}\ninfo(strFmt("KELT has %1 customers", counter));',
    expect: "no changecompany block",
  },
  {
    lesson: "07-companies",
    task: "count-across-companies",
    label: "forgets crosscompany",
    source:
      'CustTable custTable;\nint counter;\nwhile select custTable\n{\n    counter++;\n}\ninfo(strFmt("%1 customers in total", counter));',
    expect: "Use crosscompany",
  },
  {
    lesson: "07-companies",
    task: "same-key-different-row",
    label: "does not re-select inside the changecompany block",
    source:
      'CustTable custTable;\nselect firstonly custTable where custTable.AccountNum == "C-1000";\ninfo(strFmt("HVND %1", custTable.CurrencyCode));\nchangecompany ("KELT")\n{\n    info(strFmt("KELT %1", custTable.CurrencyCode));\n}',
    expect: "did not re-select inside the changecompany block",
  },

  // -- 08 Exceptions -------------------------------------------------------
  {
    lesson: "08-exceptions",
    task: "throw-and-catch",
    label: "throws the bare enum, so nothing is logged",
    source:
      'try\n{\n    throw Exception::Error;\n}\ncatch (Exception::Error)\n{\n    info("Recovered");\n}',
    expect: "bare throw Exception::Error writes nothing",
  },
  {
    lesson: "08-exceptions",
    task: "catch-outside-the-transaction",
    label: "puts the catch inside the transaction, where it never fires",
    source:
      'ttsbegin;\ntry\n{\n    throw error("failed inside the transaction");\n}\ncatch (Exception::Error)\n{\n    info("Caught outside");\n}\nttscommit;',
    expect: "cannot be caught by a catch that is also inside it",
  },
  {
    lesson: "08-exceptions",
    task: "retry-until-it-works",
    label: "loops with a while instead of retry",
    source:
      'int attempts;\nwhile (attempts < 3)\n{\n    info(strFmt("attempt %1", attempts));\n    attempts++;\n}\ninfo("Succeeded");',
    expect: "no retry statement",
  },
];

describe("wrong answers get the message that addresses them", () => {
  it.each(
    WRONG.map((entry) => [`${entry.lesson} / ${entry.task} — ${entry.label}`, entry] as const),
  )("%s", async (_label, entry) => {
    const result = await runTask({
      task: taskFor(entry.lesson, entry.task),
      source: entry.source,
      db,
    });

    expect(result.passed, "this answer should not pass").toBe(false);
    expect(feedbackFor(result)).toContain(entry.expect);
  });

  it("covers every lesson in the track", () => {
    const covered = new Set(WRONG.map((entry) => entry.lesson));
    for (const [slug] of lessonList()) {
      expect({ lesson: slug, hasWrongAnswers: covered.has(slug) }).toEqual({
        lesson: slug,
        hasWrongAnswers: true,
      });
    }
  });
});
