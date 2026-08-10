import { describe, expect, it } from "vitest";
import {
  COMPANIES,
  SCHEMA,
  SEEDS,
  TABLE_NAMES,
  createVirtualDb,
  getTableSchema,
  selectToSql,
} from "@xpplab/virtual-db";
import type { SelectClauses } from "@xpplab/xpp-parser";

describe("virtual-db contract", () => {
  it("declares the Phase 1 starter table set", () => {
    expect(TABLE_NAMES).toContain("CustTable");
    expect(TABLE_NAMES).toContain("LedgerJournalTrans");
    expect(TABLE_NAMES).toContain("DirPartyTable");
    expect(new Set(TABLE_NAMES).size).toBe(TABLE_NAMES.length);
  });

  it("has no seed data yet — Phase 1 authors it", () => {
    expect(SCHEMA).toEqual([]);
    expect(COMPANIES).toEqual([]);
    expect(Object.keys(SEEDS)).toEqual([]);
  });

  it("declares the public surface but does not implement it yet", () => {
    expect(() => createVirtualDb()).toThrowError("not implemented");
    expect(() => getTableSchema("CustTable")).toThrowError("not implemented");
    expect(() =>
      selectToSql({} as SelectClauses, { company: "NRTH", resolveBuffer: () => undefined }),
    ).toThrowError("not implemented");
  });
});
