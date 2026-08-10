/**
 * Company scoping — the other half of the Phase 1 acceptance criterion.
 *
 * This is one of the highest-value concepts for the NAV/BC audience: F&O keeps one
 * `CustTable` with a `DATAAREAID` column, where NAV gives each company its own table set.
 * If this is wrong, lesson 7 teaches a lie, so it is tested hard.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { COMPANIES, createVirtualDb, getTableSchema } from "../src/index.js";
import type { VirtualDb } from "../src/index.js";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

describe("legal entities", () => {
  it("seeds three fictional companies", () => {
    expect(COMPANIES).toHaveLength(3);
    expect(COMPANIES.map((c) => c.id)).toEqual(["HVND", "KELT", "MRDA"]);
  });

  it("uses DATAAREAID values that fit the real 4-character limit", () => {
    for (const company of COMPANIES) {
      expect(company.id.length).toBeLessThanOrEqual(4);
    }
  });

  it("starts in the first company unless told otherwise", () => {
    expect(db.getCompany()).toBe("HVND");
  });

  it("honours an explicit starting company", async () => {
    const other = createVirtualDb({ company: "KELT" });
    await other.init();
    expect(other.getCompany()).toBe("KELT");
    await other.close();
  });

  it("rejects a company that does not exist", async () => {
    await expect(db.setCompany("ZZZZ")).rejects.toThrow(/ZZZZ/);
  });

  it("lists the seeded companies", async () => {
    expect(await db.listCompanies()).toEqual(["HVND", "KELT", "MRDA"]);
  });
});

describe("company filtering", () => {
  it("returns only rows in the active company", async () => {
    const rows = await db.readRows("CustTable");

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row["DATAAREAID"]).toBe("HVND");
    }
  });

  it("returns a different set after changecompany", async () => {
    const inHvnd = await db.readRows("CustTable");
    await db.setCompany("KELT");
    const inKelt = await db.readRows("CustTable");

    expect(inKelt.length).toBeGreaterThan(0);
    for (const row of inKelt) {
      expect(row["DATAAREAID"]).toBe("KELT");
    }

    const hvndRecIds = new Set(inHvnd.map((r) => r["RECID"]));
    for (const row of inKelt) {
      expect(hvndRecIds.has(row["RECID"])).toBe(false);
    }
  });

  it("crosses companies on request, which is what crosscompany compiles to", async () => {
    const scoped = await db.readRows("CustTable");
    const all = await db.readRows("CustTable", { company: "all" });

    expect(all.length).toBeGreaterThan(scoped.length);
    expect(new Set(all.map((r) => r["DATAAREAID"]))).toEqual(new Set(["HVND", "KELT", "MRDA"]));
  });

  it("keeps the same customer account number distinct per company", async () => {
    const all = await db.readRows("CustTable", { company: "all" });
    const byAccount = all.filter((row) => row["AccountNum"] === "C-1000");

    // Same natural key, different companies, different records. This is the single
    // most important thing a NAV developer has to internalise about F&O.
    expect(byAccount.length).toBeGreaterThan(1);
    expect(new Set(byAccount.map((r) => r["RECID"])).size).toBe(byAccount.length);
  });
});

describe("shared tables", () => {
  it("marks DirPartyTable as shared rather than company-scoped", () => {
    expect(getTableSchema("DirPartyTable")?.saveDataPerCompany).toBe(false);
    expect(getTableSchema("CustTable")?.saveDataPerCompany).toBe(true);
  });

  it("returns the same shared rows whichever company is active", async () => {
    const inHvnd = await db.readRows("DirPartyTable");
    await db.setCompany("MRDA");
    const inMrda = await db.readRows("DirPartyTable");

    expect(inMrda.length).toBe(inHvnd.length);
    expect(inMrda.map((r) => r["RECID"])).toEqual(inHvnd.map((r) => r["RECID"]));
  });
});
