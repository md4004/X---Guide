import { describe, expect, it } from "vitest";
import { findAll, isInsideTransaction, parse, parseExpression, walk } from "@xpplab/xpp-parser";
import type { NodeKind, SourceUnit, Statement } from "@xpplab/xpp-parser";

/**
 * These kind strings are named directly by `ast` validators in authored lessons
 * (`usesStatement: "whileSelect"`). Renaming one silently breaks every lesson that
 * asserts on it, so pin them here.
 */
const CONTRACTUAL_KINDS = [
  "whileSelect",
  "select",
  "insertRecordset",
  "updateRecordset",
  "deleteFrom",
  "tryCatch",
  "ttsBegin",
  "ttsCommit",
  "ttsAbort",
  "changeCompany",
] as const satisfies readonly NodeKind[];

describe("xpp-parser contract", () => {
  it("keeps the validator-facing node kinds stable", () => {
    expect(CONTRACTUAL_KINDS).toHaveLength(10);
  });

  it("declares the public surface but does not implement it yet", () => {
    const fakeUnit = { kind: "sourceUnit" } as SourceUnit;
    const fakeStatement = { kind: "ttsBegin" } as Statement;

    expect(() => parse("ttsbegin;")).toThrowError("not implemented");
    expect(() => parseExpression("1 + 1")).toThrowError("not implemented");
    expect(() => walk(fakeUnit, {})).toThrowError("not implemented");
    expect(() => findAll(fakeUnit, "whileSelect")).toThrowError("not implemented");
    expect(() => isInsideTransaction(fakeUnit, fakeStatement)).toThrowError("not implemented");
  });
});
