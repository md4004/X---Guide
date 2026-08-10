import { describe, expect, it } from "vitest";
import { BASE_MODEL, createVirtualAot } from "@xpplab/virtual-aot";

describe("virtual-aot contract", () => {
  it("starts from an empty authored model — Phase 7 populates it", () => {
    expect(BASE_MODEL.tables).toEqual([]);
    expect(BASE_MODEL.stubClasses).toEqual([]);
  });

  it("declares the public surface but does not implement it yet", () => {
    expect(() => createVirtualAot()).toThrowError("not implemented");
  });
});
