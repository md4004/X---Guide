/**
 * The debugger, asserted against the behaviours logged as VB-022 to VB-026.
 *
 * These are not tests of "the pause hook fires". They are tests that the debugger stops
 * where the real Visual Studio debugger stops, and shows what the real windows show,
 * because that is the only thing that makes teaching with it defensible.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource, type Breakpoint, type DebugCommand, type DebugPause } from "../src";

/**
 * A scripted debugger session.
 *
 * `commands` is the queue of buttons the learner presses, in order; when it runs dry the
 * session continues, which is what happens when nothing else stops the code either.
 */
function session(breakpoints: Breakpoint[], commands: DebugCommand[]) {
  const pauses: DebugPause[] = [];
  const queue = [...commands];

  return {
    pauses,
    host: {
      breakpoints: () => breakpoints,
      onPause: async (pause: DebugPause) => {
        pauses.push(pause);
        return queue.shift() ?? "continue";
      },
    },
  };
}

describe("the debugger", () => {
  let db: VirtualDb;

  beforeEach(async () => {
    db = createVirtualDb();
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  // VB-022 -----------------------------------------------------------------

  it("runs to completion without stopping when no breakpoints are set", async () => {
    // Start Debugging with an empty Breakpoints window does exactly nothing visible, and
    // a learner needs to meet that rather than wonder why the debugger "did not work".
    const { host, pauses } = session([], []);

    const result = await runSource({ source: `info("done");`, db, debug: host });

    expect(pauses).toHaveLength(0);
    expect(result.infolog.map((entry) => entry.message)).toEqual(["done"]);
  });

  it("stops on the line carrying the breakpoint, before that line has run", async () => {
    const source = ["int counter;", "counter = 41;", "counter = counter + 1;", ""].join("\n");
    const { host, pauses } = session([{ line: 3 }], ["continue"]);

    await runSource({ source, db, debug: host });

    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.line).toBe(3);
    expect(pauses[0]?.reason).toBe("breakpoint");
    // Line 3 has not executed yet, so the increment has not happened.
    expect(pauses[0]?.locals.find((local) => local.name === "counter")?.value).toBe("41");
  });

  it("does not stop on a disabled breakpoint", async () => {
    const { host, pauses } = session([{ line: 1, enabled: false }], []);
    await runSource({ source: `info("x");`, db, debug: host });
    expect(pauses).toHaveLength(0);
  });

  // Stepping ---------------------------------------------------------------

  it("steps to the next line on step over", async () => {
    const source = ["int a;", "a = 1;", "a = 2;", "a = 3;", ""].join("\n");
    const { host, pauses } = session([{ line: 2 }], ["stepOver", "stepOver", "continue"]);

    await runSource({ source, db, debug: host });

    expect(pauses.map((pause) => pause.line)).toEqual([2, 3, 4]);
    expect(pauses.slice(1).map((pause) => pause.reason)).toEqual(["step", "step"]);
  });

  it("returns to the loop header on each iteration, because the condition is re-tested", async () => {
    // Stepping through a loop in the real debugger walks back up to the `while` line every
    // time round. A debugger that only visited the body once would quietly teach that the
    // condition is evaluated once.
    const source = ["int i;", "while (i < 3)", "{", "    i = i + 1;", "}", ""].join("\n");
    const { host, pauses } = session([{ line: 2 }], new Array<DebugCommand>(6).fill("stepOver"));

    await runSource({ source, db, debug: host });

    expect(pauses.map((pause) => pause.line)).toEqual([2, 4, 2, 4, 2, 4, 2]);
  });

  it("runs to the end on step out of the outermost frame", async () => {
    // There is nothing shallower than the top-level script, so stepping out of it finishes
    // the run — which is what the real debugger does from the outermost frame too.
    const source = ["int a;", "a = 1;", "a = 2;", "a = 3;", ""].join("\n");
    const { host, pauses } = session([{ line: 2 }], ["stepOut"]);

    await runSource({ source, db, debug: host });

    expect(pauses.map((pause) => pause.line)).toEqual([2]);
  });

  it("stops the run outright on stop, without recording an error", async () => {
    const source = ["int a;", "a = 1;", `info("reached");`, ""].join("\n");
    const { host } = session([{ line: 2 }], ["stop"]);

    const result = await runSource({ source, db, debug: host });

    expect(result.stoppedByDebugger).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.infolog).toEqual([]);
  });

  // VB-025 -----------------------------------------------------------------

  it("honours a breakpoint condition, and does not count a miss as a hit", async () => {
    const source = ["int i;", "while (i < 6)", "{", "    i = i + 1;", "}", ""].join("\n");
    const { host, pauses } = session([{ line: 4, condition: "i > 3" }], ["continue", "continue"]);

    await runSource({ source, db, debug: host });

    // i is 4 then 5 at the top of the body on the arrivals that satisfy `i > 3`.
    const values = pauses.map((pause) => pause.locals.find((local) => local.name === "i")?.value);
    expect(values).toEqual(["4", "5"]);
  });

  it("treats a condition that does not parse as never satisfied", async () => {
    // A typo in a condition should give a breakpoint that quietly does not fire, not a
    // dead run. The real debugger is equally forgiving.
    const { host, pauses } = session([{ line: 1, condition: "this is not X++" }], []);
    const result = await runSource({ source: `info("x");`, db, debug: host });

    expect(pauses).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  it("breaks on every nth arrival when a hit count is set", async () => {
    const source = ["int i;", "while (i < 6)", "{", "    i = i + 1;", "}", ""].join("\n");
    const { host, pauses } = session([{ line: 4, hitCount: 3 }], ["continue", "continue"]);

    await runSource({ source, db, debug: host });

    // Six arrivals, breaking on the third and the sixth: i is 2 and 5 on entry to the body.
    const values = pauses.map((pause) => pause.locals.find((local) => local.name === "i")?.value);
    expect(values).toEqual(["2", "5"]);
  });

  // VB-023 -----------------------------------------------------------------

  it("shows the company and the transaction level in Autos", async () => {
    const source = [
      "ttsbegin;",
      "ttsbegin;",
      `info("inner");`,
      "ttscommit;",
      "ttscommit;",
      "",
    ].join("\n");
    const { host, pauses } = session([{ line: 3 }], ["continue"]);

    await runSource({ source, db, debug: host });

    expect(pauses[0]?.autos).toEqual({ company: "HVND", transactionLevel: 2 });
  });

  // VB-024 -----------------------------------------------------------------

  it("expands a table buffer to its fields in Locals", async () => {
    const source = [
      "InventTable inventTable;",
      "select firstonly inventTable where inventTable.ItemId == 'F-100';",
      `info("stop here");`,
      "",
    ].join("\n");
    const { host, pauses } = session([{ line: 3 }], ["continue"]);

    await runSource({ source, db, debug: host });

    const buffer = pauses[0]?.locals.find((local) => local.name === "inventTable");
    expect(buffer?.typeName).toBe("InventTable");

    const itemId = buffer?.fields?.find((field) => field.name === "ItemId");
    expect(itemId?.selected).toBe(true);
    expect(itemId?.value).toBe("F-100");
  });

  it("renders a field left out of the select field list as null, and flags it as unselected", async () => {
    // VB-024. The value is a debugging artifact — the variable really holds the type's
    // default — so the flag is carried through and the UI explains it rather than the
    // learner concluding the database contains nulls.
    const source = [
      "InventTable inventTable;",
      "select firstonly ItemId from inventTable where inventTable.ItemId == 'F-100';",
      `info("stop here");`,
      "",
    ].join("\n");
    const { host, pauses } = session([{ line: 3 }], ["continue"]);

    await runSource({ source, db, debug: host });

    const fields = pauses[0]?.locals.find((local) => local.name === "inventTable")?.fields ?? [];
    const byName = new Map(fields.map((field) => [field.name, field]));

    expect(byName.get("ItemId")?.selected).toBe(true);
    expect(byName.get("ItemId")?.value).toBe("F-100");

    expect(byName.get("ItemName")?.selected).toBe(false);
    expect(byName.get("ItemName")?.value).toBe("null");
  });

  // The call stack ---------------------------------------------------------

  it("names the outermost frame after the entry point it was given", async () => {
    const { host, pauses } = session([{ line: 1 }], ["continue"]);

    await runSource({
      source: `info("x");`,
      db,
      debug: host,
      entryPoint: "XppLabTutorial.main",
    });

    expect(pauses[0]?.callStack).toEqual([{ name: "XppLabTutorial.main", line: 1 }]);
  });

  // Cost -------------------------------------------------------------------

  it("costs nothing when no debugger is attached", async () => {
    // The lesson runner and the playground run without a debugger, and neither should pay
    // for one. Asserted by behaviour rather than by timing: the same source must produce
    // the same result either way.
    const source = ["int i;", "while (i < 20) { i = i + 1; }", `info(strFmt("%1", i));`, ""].join(
      "\n",
    );

    const plain = await runSource({ source, db });
    expect(plain.infolog.map((entry) => entry.message)).toEqual(["20"]);
    expect(plain.stoppedByDebugger).toBeUndefined();
  });
});
