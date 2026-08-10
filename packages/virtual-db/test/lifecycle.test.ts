/**
 * Snapshot, restore and reset.
 *
 * The lesson runner snapshots before a run and restores after, so a learner's fourth
 * attempt starts from exactly the state their first did. If this drifts, every lesson
 * becomes order-dependent and nobody will work out why.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb } from "../src/index.js";
import type { VirtualDb } from "../src/index.js";

let db: VirtualDb;

const itemCount = async () => (await db.readRows("InventTable")).length;

const insertItem = (itemId: string) =>
  db.exec(
    "INSERT INTO InventTable (ItemId, ItemName, ItemGroupId, ItemType, Blocked, DATAAREAID) VALUES (?, ?, ?, ?, ?, ?)",
    [itemId, "Scratch", "FURNITURE", 0, 0, db.getCompany()],
  );

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

describe("snapshot and restore", () => {
  it("restores the row set the snapshot was taken at", async () => {
    const before = await itemCount();
    const snapshot = await db.snapshot();

    await insertItem("SCRATCH-1");
    await insertItem("SCRATCH-2");
    expect(await itemCount()).toBe(before + 2);

    await db.restore(snapshot);
    expect(await itemCount()).toBe(before);
  });

  it("restores deletions as well as insertions", async () => {
    const snapshot = await db.snapshot();
    await db.exec("DELETE FROM InventTable WHERE DATAAREAID = ?", [db.getCompany()]);
    expect(await itemCount()).toBe(0);

    await db.restore(snapshot);
    expect(await itemCount()).toBeGreaterThan(0);
  });

  it("discards a transaction left open when the snapshot is restored", async () => {
    const snapshot = await db.snapshot();

    await db.beginTransaction();
    await db.beginTransaction();
    expect((await db.getTransactionState()).depth).toBe(2);

    await db.restore(snapshot);

    expect((await db.getTransactionState()).depth).toBe(0);
  });

  it("carries the seed name so a restored environment knows what it came from", async () => {
    const snapshot = await db.snapshot();
    expect(snapshot.seed).toBe("default");
    expect(snapshot.bytes.byteLength).toBeGreaterThan(0);
  });

  it("clears the trace on restore, since those statements no longer describe the state", async () => {
    await insertItem("SCRATCH-3");
    const snapshot = await db.snapshot();
    expect(db.getTrace().length).toBeGreaterThan(0);

    await db.restore(snapshot);
    expect(db.getTrace()).toEqual([]);
  });
});

describe("reset", () => {
  it("rebuilds from the seed, discarding everything the learner did", async () => {
    const before = await itemCount();
    await insertItem("SCRATCH-4");
    expect(await itemCount()).toBe(before + 1);

    await db.reset();
    expect(await itemCount()).toBe(before);
  });

  it("switches to a different seed on request", async () => {
    await db.reset("empty");
    expect(await itemCount()).toBe(0);
    expect(await db.readRows("CustTable")).toEqual([]);

    await db.reset("default");
    expect(await itemCount()).toBeGreaterThan(0);
  });

  it("rejects a seed that does not exist, naming the ones that do", async () => {
    await expect(db.reset("nonexistent")).rejects.toThrow(/Unknown seed.*default.*empty/s);
  });

  it("hands out the same RECIDs after a reset, so lessons are reproducible", async () => {
    const first = (await db.readRows("InventTable")).map((row) => row["RECID"]);
    await insertItem("SCRATCH-5");
    await db.reset();
    const second = (await db.readRows("InventTable")).map((row) => row["RECID"]);

    expect(second).toEqual(first);
  });
});

describe("seeded shape", () => {
  it("assigns a RECID to every seeded row", async () => {
    for (const table of await db.listTables()) {
      const rows = await db.readRows(table, { company: "all" });
      for (const row of rows) {
        expect(typeof row["RECID"]).toBe("number");
      }
    }
  });

  it("keeps RECIDs unique within a table across companies", async () => {
    const rows = await db.readRows("CustTable", { company: "all" });
    const recIds = rows.map((row) => row["RECID"]);
    expect(new Set(recIds).size).toBe(recIds.length);
  });

  it("does not reuse a RECID after a delete, as F&O does not", async () => {
    await insertItem("SCRATCH-6");
    const inserted = (await db.readRows("InventTable")).at(-1)!["RECID"];

    await db.exec("DELETE FROM InventTable WHERE ItemId = ? AND DATAAREAID = ?", [
      "SCRATCH-6",
      db.getCompany(),
    ]);
    await insertItem("SCRATCH-7");
    const next = (await db.readRows("InventTable")).at(-1)!["RECID"];

    expect(next).toBeGreaterThan(Number(inserted));
  });

  it("resolves DirPartyTable references from CustTable.Party", async () => {
    const customers = await db.readRows("CustTable");
    const parties = await db.readRows("DirPartyTable");
    const partyRecIds = new Set(parties.map((row) => row["RECID"]));

    expect(customers.length).toBeGreaterThan(0);
    for (const customer of customers) {
      expect(partyRecIds.has(customer["Party"])).toBe(true);
    }
  });
});

describe("close", () => {
  it("refuses further work after close", async () => {
    await db.close();
    await expect(db.readRows("CustTable")).rejects.toThrow(/not been initialised/i);
  });
});
