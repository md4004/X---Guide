import { describe, expect, it } from "vitest";
import { XppErrorCodes } from "@xpplab/xpp-core";
import { XPP_KEYWORDS, XPP_PUNCTUATORS, isKeyword, tokenize } from "@xpplab/xpp-lexer";
import type { Token } from "@xpplab/xpp-lexer";

/** Tokens without the trailing eof, which every assertion below would otherwise repeat. */
const scan = (source: string): Token[] => tokenize(source).tokens.slice(0, -1);
const kinds = (source: string) => scan(source).map((token) => token.kind);
const texts = (source: string) => scan(source).map((token) => token.text);

describe("keyword and punctuator tables", () => {
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
});

describe("basic scanning", () => {
  it("classifies a simple statement", () => {
    expect(kinds('info("hello");')).toEqual([
      "identifier",
      "punctuator",
      "strLiteral",
      "punctuator",
      "punctuator",
    ]);
  });

  it("preserves original casing on keywords while lowercasing the keyword field", () => {
    const [token] = scan("SELECT");
    expect(token?.kind).toBe("keyword");
    expect(token?.text).toBe("SELECT");
    expect(token?.keyword).toBe("select");
  });

  it("drops whitespace and comments unless asked for them", () => {
    expect(kinds("// note\nint a; /* block */")).toEqual(["keyword", "identifier", "punctuator"]);
  });

  it("emits trivia on request, so the editor grammar can use it", () => {
    const tokens = tokenize("int a; // note", { includeTrivia: true }).tokens;
    const trivia = tokens.filter((token) => token.kind === "trivia");
    expect(trivia.map((token) => token.trivia)).toEqual([
      "whitespace",
      "whitespace",
      "lineComment",
    ]);
  });

  it("uses maximal munch, so >>= is one token and not three", () => {
    expect(texts("a >>= b")).toEqual(["a", ">>=", "b"]);
    expect(texts("a >= b")).toEqual(["a", ">=", "b"]);
    expect(texts("a > b")).toEqual(["a", ">", "b"]);
    expect(texts("a::b")).toEqual(["a", "::", "b"]);
  });
});

describe("literals", () => {
  it("reads integers and reals apart", () => {
    const [int, , real] = scan("42 + 3.5");
    expect(int).toMatchObject({ kind: "intLiteral", value: 42 });
    expect(real).toMatchObject({ kind: "realLiteral", value: 3.5 });
  });

  it("does not treat a trailing dot as a decimal point", () => {
    // `custTable.` must stay a member access, not become a real literal.
    expect(kinds("1.toString")).toEqual(["intLiteral", "punctuator", "identifier"]);
  });

  it("reads both quote styles, and decodes escapes", () => {
    expect(scan('"double"')[0]).toMatchObject({ kind: "strLiteral", value: "double" });
    expect(scan("'single'")[0]).toMatchObject({ kind: "strLiteral", value: "single" });
    expect(scan('"a\\"b"')[0]).toMatchObject({ value: 'a"b' });
    expect(scan('"a\\\\b"')[0]).toMatchObject({ value: "a\\b" });
  });

  it("reads a date literal without deciding what its components mean", () => {
    // Component order is unconfirmed — see docs/unverified.md. The token keeps the
    // source text and Phase 3 interprets it.
    expect(scan("31\\12\\2026")[0]).toMatchObject({
      kind: "dateLiteral",
      value: "31\\12\\2026",
    });
  });

  it("reads true, false and null as keywords, not identifiers", () => {
    expect(kinds("true false null")).toEqual(["keyword", "keyword", "keyword"]);
  });
});

describe("positions", () => {
  it("counts lines and columns from one", () => {
    const [first] = scan("int");
    expect(first?.span.start).toEqual({ line: 1, column: 1, offset: 0 });
  });

  it("advances the line on a newline and resets the column", () => {
    const tokens = scan("int a;\nint b;");
    const second = tokens.find((token, index) => index > 2 && token.kind === "keyword");
    expect(second?.span.start).toMatchObject({ line: 2, column: 1 });
  });

  it("gives every token an end after its start", () => {
    for (const token of scan('info("hello");\nint counter = 42;')) {
      expect(token.span.end.offset).toBeGreaterThan(token.span.start.offset);
    }
  });
});

describe("errors", () => {
  it("reports an unterminated string at the opening quote", () => {
    const { errors } = tokenize('info("never closed);');
    expect(errors[0]).toMatchObject({ code: XppErrorCodes.UnterminatedString, line: 1, column: 6 });
    expect(errors[0]?.hint).toBeDefined();
  });

  it("does not let a string run past the end of its line", () => {
    const { errors } = tokenize('str a = "oops;\nint b = 1;');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
  });

  it("reports an unterminated block comment", () => {
    const { errors } = tokenize("/* never closed");
    expect(errors[0]?.code).toBe(XppErrorCodes.UnterminatedComment);
  });

  it("reports a stray character and keeps scanning", () => {
    const { tokens, errors } = tokenize("a @ b");
    expect(errors[0]).toMatchObject({ code: XppErrorCodes.UnexpectedCharacter, column: 3 });
    // The `b` after the bad character is still tokenised.
    expect(tokens.map((t) => t.text)).toContain("b");
  });

  it("names macros rather than reporting a bare unexpected '#'", () => {
    const { errors } = tokenize("#define.MaxRetries(3)");
    expect(errors[0]?.code).toBe(XppErrorCodes.ConstructOutsideSubset);
    expect(errors[0]?.message.toLowerCase()).toContain("macros");
  });

  it("reports a second decimal point once, not as a cascade", () => {
    const { errors } = tokenize("real a = 12.34.56;");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(XppErrorCodes.InvalidNumericLiteral);
  });

  it("always terminates the stream with eof, even after errors", () => {
    for (const source of ['"unterminated', "/* unterminated", "@@@", ""]) {
      expect(tokenize(source).tokens.at(-1)?.kind).toBe("eof");
    }
  });

  it("never throws", () => {
    for (const source of ["", "\0", "@#$%", '"', "\\", "1.2.3.4"]) {
      expect(() => tokenize(source), JSON.stringify(source)).not.toThrow();
    }
  });
});
