/**
 * X++ transaction semantics on top of the savepoint stack.
 *
 * The behaviour asserted here is VB-001 and VB-002 in docs/verified-behaviour.md, both
 * sourced from Microsoft Learn's "X++ transactional integrity". The headline is that
 * `ttsabort` is NOT a savepoint rollback: it discards the whole transaction from any
 * depth and returns ttsLevel to 0.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb } from "../src/index.js";
import type { VirtualDb } from "../src/index.js";

let db: VirtualDb;

const itemIds = async () => (await db.readRows("InventTable")).map((row) => row["ItemId"]).sort();

const insertItem = (itemId: string) =>
  db.exec(
    "INSERT INTO InventTable (ItemId, ItemName, ItemGroupId, ItemType, Blocked, DATAAREAID) VALUES (?, ?, ?, ?, ?, ?)",
    [itemId, `Test ${itemId}`, "FURNITURE", 0, 0, db.getCompany()],
  );

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

describe("ttsbegin / ttscommit nesting", () => {
  it("reports a nesting depth that rises and falls", async () => {
    expect((await db.getTransactionState()).depth).toBe(0);

    expect((await db.beginTransaction()).depth).toBe(1);
    expect((await db.beginTransaction()).depth).toBe(2);
    expect((await db.commitTransaction()).depth).toBe(1);
    expect((await db.commitTransaction()).depth).toBe(0);
  });

  it("VB-002: commits nothing until the outermost ttscommit", async () => {
    const before = await itemIds();

    await db.beginTransaction();
    await insertItem("TEST-OUTER");
    await db.beginTransaction();
    await insertItem("TEST-INNER");
    await db.commitTransaction();

    // Still inside the outer transaction — nothing is durable yet.
    expect((await db.getTransactionState()).depth).toBe(1);

    await db.commitTransaction();

    expect(await itemIds()).toEqual([...before, "TEST-INNER", "TEST-OUTER"].sort());
  });

  it("rejects ttscommit with no open transaction", async () => {
    await expect(db.commitTransaction()).rejects.toThrow(/no open transaction/i);
  });

  it("rejects ttsabort with no open transaction", async () => {
    await expect(db.abortTransaction()).rejects.toThrow(/no open transaction/i);
  });
});

describe("ttsabort", () => {
  it("VB-001: aborting the inner transaction discards the outer work too", async () => {
    const before = await itemIds();

    await db.beginTransaction();
    await insertItem("TEST-OUTER");

    await db.beginTransaction();
    await insertItem("TEST-INNER");

    // Abort from depth 2. In X++ this is not a savepoint rollback — it discards the
    // entire transaction, including the insert made at depth 1.
    const state = await db.abortTransaction();

    expect(state.depth).toBe(0);
    expect(await itemIds()).toEqual(before);
  });

  it("VB-001: returns ttsLevel to 0 from any depth", async () => {
    await db.beginTransaction();
    await db.beginTransaction();
    await db.beginTransaction();

    expect((await db.abortTransaction()).depth).toBe(0);
    expect((await db.getTransactionState()).depth).toBe(0);
  });

  it("leaves work committed before the transaction started untouched", async () => {
    await db.beginTransaction();
    await insertItem("TEST-KEEP");
    await db.commitTransaction();

    await db.beginTransaction();
    await insertItem("TEST-DISCARD");
    await db.abortTransaction();

    const ids = await itemIds();
    expect(ids).toContain("TEST-KEEP");
    expect(ids).not.toContain("TEST-DISCARD");
  });
});

describe("transaction trace", () => {
  it("records savepoint, release and rollback statements so learners can see them", async () => {
    db.clearTrace();

    await db.beginTransaction();
    await db.beginTransaction();
    await db.commitTransaction();
    await db.abortTransaction();

    const kinds = db.getTrace().map((entry) => entry.kind);
    expect(kinds).toEqual(["savepoint", "savepoint", "release", "rollback"]);
  });

  it("numbers the accumulated trace as one running sequence", async () => {
    // The worker drains its trace per request, so every batch arrives starting at 0.
    // The client is what turns them into one ordered list — without that, the trace
    // panel shows every statement as number 1 and a UI keyed on sequence collides.
    db.clearTrace();

    await db.beginTransaction();
    await insertItem("TEST-SEQ-1");
    await insertItem("TEST-SEQ-2");
    await db.commitTransaction();

    const sequences = db.getTrace().map((entry) => entry.sequence);
    expect(sequences).toEqual([0, 1, 2, 3]);
  });

  it("keeps numbering contiguous across a clear", async () => {
    await db.beginTransaction();
    db.clearTrace();
    await insertItem("TEST-SEQ-3");
    await db.commitTransaction();

    expect(db.getTrace().map((entry) => entry.sequence)).toEqual([0, 1]);
  });

  it("stamps each statement with the transaction depth it ran at", async () => {
    db.clearTrace();

    await db.beginTransaction();
    await insertItem("TEST-DEPTH");
    await db.commitTransaction();

    const insert = db.getTrace().find((entry) => entry.kind === "insert");
    expect(insert?.transactionDepth).toBe(1);
  });
});
