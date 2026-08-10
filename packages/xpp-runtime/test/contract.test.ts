import { describe, expect, it } from "vitest";
import { createInfolog, createInterpreter, run } from "@xpplab/xpp-runtime";
import type { RunOptions } from "@xpplab/xpp-runtime";
import type { VirtualDb } from "@xpplab/virtual-db";
import type { SourceUnit } from "@xpplab/xpp-parser";

const options = {
  ast: { kind: "sourceUnit" } as SourceUnit,
  db: {} as VirtualDb,
} satisfies RunOptions;

describe("xpp-runtime contract", () => {
  it("declares the public surface but does not implement it yet", () => {
    expect(() => createInfolog()).toThrowError("not implemented");
    expect(() => createInterpreter(options)).toThrowError("not implemented");
    expect(() => run(options)).toThrowError("not implemented");
  });
});
