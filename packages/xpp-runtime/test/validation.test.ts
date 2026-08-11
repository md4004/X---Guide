/**
 * `validateWrite()` in the runtime.
 *
 * The metadata layer makes this method real; before it existed the runtime refused to run
 * it rather than return a meaningless `true`. What is tested here is mostly *when it does
 * not run*, because that is the behaviour learners get wrong (VB-013).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "../src/index";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const run = (source: string) => runSource({ source, db });

describe("validateWrite", () => {
  it("returns true for a record with every mandatory field filled", async () => {
    const result = await run(`
InventTable inventTable;

inventTable.ItemId = "F-500";
inventTable.ItemName = "Standing desk";

if (inventTable.validateWrite())
{
    info("valid");
}
`);

    expect(result.errors).toEqual([]);
    expect(result.infolog.map((entry) => entry.message)).toEqual(["valid"]);
  });

  it("returns false and names each empty mandatory field", async () => {
    const result = await run(`
InventTable inventTable;

inventTable.ItemName = "Nameless";

if (!inventTable.validateWrite())
{
    info("rejected");
}
`);

    expect(result.infolog.map((entry) => ({ type: entry.type, message: entry.message }))).toEqual([
      { type: "error", message: "Field 'Item number' must be filled in." },
      { type: "info", message: "rejected" },
    ]);
  });

  it("reports every failing field in one pass, not just the first", async () => {
    const result = await run(`
InventTable inventTable;
inventTable.validateWrite();
`);

    expect(result.infolog.filter((entry) => entry.type === "error")).toHaveLength(2);
  });

  it("does not throw — it reports, and the caller decides", async () => {
    // VB-012. A validateWrite that threw would make `if (buffer.validateWrite())`
    // impossible to write, which is the idiom the whole method exists for.
    const result = await run(`
InventTable inventTable;
inventTable.validateWrite();
info("still running");
`);

    expect(result.ok).toBe(true);
    expect(result.infolog.at(-1)?.message).toBe("still running");
  });

  it("is NOT called by insert() — the record lands invalid", async () => {
    // VB-013, and the single most valuable thing in the forms lesson. A form would have
    // stopped this; code does not.
    const result = await run(`
InventTable inventTable;

ttsbegin;
inventTable.ItemName = "No item id at all";
inventTable.insert();
ttscommit;

info("inserted anyway");
`);

    expect(result.errors).toEqual([]);
    expect(result.infolog.map((entry) => entry.message)).toEqual(["inserted anyway"]);

    const rows = await db.readRows("InventTable");
    expect(rows.some((row) => row["ItemName"] === "No item id at all")).toBe(true);
  });

  it("checks a string against the size its EDT allows", async () => {
    const result = await run(`
InventTable inventTable;

inventTable.ItemId = "F-500-THIS-IS-FAR-TOO-LONG-FOR-THE-TYPE";
inventTable.ItemName = "Standing desk";
inventTable.validateWrite();
`);

    expect(result.infolog[0]?.message).toContain("20 characters");
  });

  it("still refuses validateDelete rather than answering it", async () => {
    // Delete actions are not modelled, so "safe to delete" is not a claim we can make.
    const result = await run(`
InventTable inventTable;
inventTable.validateDelete();
`);

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain("validateDelete() is not available yet");
    expect(result.errors[0]?.hint).toContain("validateWrite() does work");
  });
});
