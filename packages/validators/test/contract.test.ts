import { describe, expect, it } from "vitest";
import { runValidators, verifyTask } from "@xpplab/validators";
import type { TaskDefinition, ValidationContext } from "@xpplab/validators";
import type { RunResult } from "@xpplab/xpp-runtime";
import type { VirtualDb } from "@xpplab/virtual-db";

/**
 * The worked example from docs/lesson-schema.md, typed. If the schema doc and these
 * types ever drift apart, this file stops compiling — which is the point.
 */
const exampleTask: TaskDefinition = {
  id: "loop-blocked-items",
  prompt: "Block every item in the FURNITURE group, then log how many you changed.",
  starter: "InventTable inventTable;\nint counter;\n\n// your code here",
  solution: "ttsbegin;\n// ...\nttscommit;",
  hints: [
    "A buffer is declared like any other variable — type first, then name.",
    "Reading and writing in the same pass needs forupdate.",
    "Nothing is written until ttscommit.",
  ],
  validators: [
    {
      kind: "ast",
      rule: "usesStatement",
      value: "whileSelect",
      message:
        "You got the right rows, but not with a `while select`. This lesson is about looping a result set — a nested loop over everything will not scale.",
    },
    {
      kind: "ast",
      rule: "usesModifier",
      value: "forupdate",
      message:
        "Your loop reads the records but can't write to them — a buffer selected without `forupdate` is read-only.",
    },
    {
      kind: "ast",
      rule: "wrappedIn",
      value: "transaction",
      message:
        "F&O will not let you write outside a transaction. Wrap the loop in `ttsbegin` and `ttscommit`.",
    },
    {
      kind: "state",
      table: "InventTable",
      where: { ItemGroupId: "FURNITURE" },
      expect: { Blocked: 1 },
      all: true,
      message: "Some FURNITURE items are still unblocked. Check your `where` clause.",
    },
    {
      kind: "state",
      table: "InventTable",
      where: { ItemGroupId: "RAWMAT" },
      expect: { Blocked: 0 },
      all: true,
      message:
        "You blocked items outside the FURNITURE group. Your `where` clause is matching too much.",
    },
    {
      kind: "output",
      match: "^Blocked \\d+ items$",
      type: "info",
      message:
        'Nothing was logged. Finish with `info(strFmt("Blocked %1 items", counter));` so you can see what happened.',
    },
    {
      kind: "sql",
      rule: "maxStatements",
      value: 12,
      message:
        "The rows are right, but look at the SQL trace: one UPDATE per record. This is the row-by-row habit F&O punishes.",
    },
  ],
};

const context: ValidationContext = {
  ast: null,
  run: {} as RunResult,
  db: {} as VirtualDb,
};

describe("validators contract", () => {
  it("types the worked example from the lesson schema", () => {
    expect(exampleTask.validators).toHaveLength(7);
    expect(exampleTask.hints).toHaveLength(3);
  });

  it("requires an authored failure message on every validator", () => {
    for (const validator of exampleTask.validators) {
      expect(validator.message.length).toBeGreaterThan(20);
    }
  });

  it("declares the public surface but does not implement it yet", () => {
    expect(() => runValidators(exampleTask.validators, context)).toThrowError("not implemented");
    expect(() => verifyTask(exampleTask, context)).toThrowError("not implemented");
  });
});
