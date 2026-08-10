import { describe, expect, it } from "vitest";
import { XPP_KEYWORDS, XPP_PUNCTUATORS, isKeyword, tokenize } from "@xpplab/xpp-lexer";

describe("xpp-lexer contract", () => {
  it("exposes a keyword set that is lowercase and unique", () => {
    expect(new Set(XPP_KEYWORDS).size).toBe(XPP_KEYWORDS.length);
    for (const keyword of XPP_KEYWORDS) {
      expect(keyword).toBe(keyword.toLowerCase());
    }
  });

  it("matches keywords case-insensitively, the way X++ does", () => {
    expect(isKeyword("select")).toBe(true);
    expect(isKeyword("SELECT")).toBe(true);
    expect(isKeyword("custTable")).toBe(false);
  });

  it("orders punctuators longest-first so maximal munch can walk the list", () => {
    const lengths = XPP_PUNCTUATORS.map((p) => p.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it("declares tokenize but does not implement it yet", () => {
    expect(() => tokenize("info('hi');")).toThrowError("not implemented");
  });
});
