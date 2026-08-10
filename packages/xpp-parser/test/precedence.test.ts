/**
 * Operator precedence — VB-005.
 *
 * X++ precedence is not C's, and Microsoft's own reference says so outright: "the
 * operator precedence of X++ isn't the same as the operator precedence of other
 * languages, such as C# and Java."
 *
 * Three differences matter, and every one of them is a trap for the audience this site
 * is for. If any of these assertions ever flips, a lesson starts teaching a lie — so
 * they are asserted on the parse tree directly rather than through a snapshot.
 */

import { describe, expect, it } from "vitest";
import { parseExpression } from "../src/index.js";
import type { Expression } from "../src/index.js";

/** Renders a tree as fully-parenthesised source, so precedence is readable at a glance. */
function shape(expression: Expression | null): string {
  if (expression === null) return "<parse failed>";

  switch (expression.kind) {
    case "binary":
      return `(${shape(expression.left)} ${expression.operator} ${shape(expression.right)})`;
    case "unary":
      return `(${expression.operator} ${shape(expression.argument)})`;
    case "conditional":
      return `(${shape(expression.test)} ? ${shape(expression.consequent)} : ${shape(expression.alternate)})`;
    case "assignment":
      return `(${shape(expression.target)} ${expression.operator} ${shape(expression.value)})`;
    case "literal":
      return expression.raw;
    case "identifier":
      return expression.name;
    case "update":
      return expression.prefix
        ? `(${expression.operator} ${shape(expression.argument)})`
        : `(${shape(expression.argument)} ${expression.operator})`;
    default:
      return expression.kind;
  }
}

const parsed = (source: string) => shape(parseExpression(source));

describe("logical operators share one level, left to right", () => {
  // The two worked examples from the source page. In C these would group differently
  // and both would evaluate the other way.
  it("parses 0 && 0 || 1 as (0 && 0) || 1", () => {
    expect(parsed("0 && 0 || 1")).toBe("((0 && 0) || 1)");
  });

  it("parses 1 || 0 && 0 as (1 || 0) && 0", () => {
    expect(parsed("1 || 0 && 0")).toBe("((1 || 0) && 0)");
  });

  it("does NOT give && higher precedence than ||, the way C does", () => {
    // C, C#, Java and TypeScript would all produce (a || (b && c)).
    expect(parsed("a || b && c")).toBe("((a || b) && c)");
  });
});

describe("bitwise operators bind far tighter than in C", () => {
  it("binds & as tightly as *, so 1 | 2 & 3 is 1 | (2 & 3)", () => {
    expect(parsed("1 | 2 & 3")).toBe("(1 | (2 & 3))");
  });

  it("binds | at the additive level, so 1 + 2 | 3 is (1 + 2) | 3", () => {
    expect(parsed("1 + 2 | 3")).toBe("((1 + 2) | 3)");
  });

  it("binds ^ as tightly as *, so 1 + 2 ^ 3 is 1 + (2 ^ 3)", () => {
    expect(parsed("1 + 2 ^ 3")).toBe("(1 + (2 ^ 3))");
  });

  it("binds shifts as tightly as *, so 1 + 2 << 3 is 1 + (2 << 3)", () => {
    // In C, << is below + and this would be (1 + 2) << 3.
    expect(parsed("1 + 2 << 3")).toBe("(1 + (2 << 3))");
  });
});

describe("arithmetic", () => {
  it("binds * above +", () => {
    expect(parsed("1 + 2 * 3")).toBe("(1 + (2 * 3))");
  });

  it("binds div and mod at the multiplicative level", () => {
    expect(parsed("1 + 100 div 21")).toBe("(1 + (100 div 21))");
    expect(parsed("1 + 100 mod 21")).toBe("(1 + (100 mod 21))");
  });

  it("associates same-level operators left to right", () => {
    expect(parsed("1 - 2 - 3")).toBe("((1 - 2) - 3)");
    expect(parsed("1 / 2 / 3")).toBe("((1 / 2) / 3)");
  });

  it("honours explicit parentheses over precedence", () => {
    expect(parsed("(1 + 2) * 3")).toBe("((1 + 2) * 3)");
  });
});

describe("relational and equality", () => {
  it("binds arithmetic above comparison", () => {
    expect(parsed("1 + 2 < 3 * 4")).toBe("((1 + 2) < (3 * 4))");
  });

  it("binds comparison above logical", () => {
    expect(parsed("a == 1 && b == 2")).toBe("((a == 1) && (b == 2))");
  });

  it("treats like, is and as at the relational level", () => {
    expect(parsed('name like "Hav*" && ready')).toBe('((name like "Hav*") && ready)');
    expect(parsed("basec is DerivedClass && ready")).toBe("((basec is DerivedClass) && ready)");
  });
});

describe("unary and conditional", () => {
  it("binds unary tightest", () => {
    expect(parsed("-1 + 2")).toBe("((- 1) + 2)");
    expect(parsed("!a && b")).toBe("((! a) && b)");
    expect(parsed("~1 * 2")).toBe("((~ 1) * 2)");
  });

  it("puts the conditional below everything else", () => {
    expect(parsed("a > 1 ? 1 : 5")).toBe("((a > 1) ? 1 : 5)");
  });

  it("makes assignment right-associative", () => {
    expect(parsed("a = b = 1")).toBe("(a = (b = 1))");
  });

  it("binds assignment below the conditional", () => {
    expect(parsed("a = b > 1 ? 1 : 5")).toBe("(a = ((b > 1) ? 1 : 5))");
  });
});
