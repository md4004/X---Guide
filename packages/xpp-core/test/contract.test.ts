import { describe, expect, it } from "vitest";
import {
  EXECUTION_LIMITS,
  XppErrorCodes,
  createError,
  err,
  ok,
  type SourceSpan,
} from "@xpplab/xpp-core";

const span: SourceSpan = {
  start: { line: 4, column: 5, offset: 42 },
  end: { line: 4, column: 14, offset: 51 },
};

describe("xpp-core", () => {
  it("builds an error from a span, carrying the range for the editor marker", () => {
    const error = createError(
      XppErrorCodes.BufferNotSelectedForUpdate,
      "The record must be selected for update.",
      span,
      "Add `forupdate` to the select that read this buffer.",
    );

    expect(error).toEqual({
      code: "XR101",
      message: "The record must be selected for update.",
      line: 4,
      column: 5,
      endLine: 4,
      endColumn: 14,
      hint: "Add `forupdate` to the select that read this buffer.",
    });
  });

  it("omits the range when given a bare position", () => {
    const error = createError(XppErrorCodes.UnexpectedToken, "Unexpected token.", span.start);

    expect(error.endLine).toBeUndefined();
    expect(error.hint).toBeUndefined();
  });

  it("keeps error codes unique", () => {
    const codes = Object.values(XppErrorCodes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("narrows Result on the ok flag", () => {
    const good = ok(1);
    const bad = err<number>([createError(XppErrorCodes.TypeMismatch, "nope", span.start)]);

    expect(good.ok ? good.value : null).toBe(1);
    expect(bad.ok ? null : bad.errors).toHaveLength(1);
  });

  it("states the runner contract's budget once", () => {
    expect(EXECUTION_LIMITS.timeoutMs).toBe(3_000);
    expect(EXECUTION_LIMITS.maxStatements).toBe(100_000);
  });
});
