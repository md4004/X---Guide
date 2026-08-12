/**
 * The broken-snippet corpus.
 *
 * Expectations are hand-written, not snapshotted: these are the messages a learner
 * actually meets, and "whatever the parser happened to say" is not a specification.
 *
 * Every entry asserts the error code and the 1-based line within its snippet. Message
 * text is checked loosely, but the presence of a hint is checked strictly — an error
 * with no hint teaches nothing (CLAUDE.md > Engine conventions).
 */

import { describe, expect, it } from "vitest";
import { XppErrorCodes } from "@xpplab/xpp-core";
import { parse } from "../src/index.js";
import { errorSnippets } from "../fixtures/load.js";

interface Expectation {
  /** The first error's code. */
  code: string;
  /** 1-based line within the snippet. */
  line: number;
  /** A fragment the message must contain, lowercased. */
  contains: string;
  /** Set when this error is expected to carry no hint. */
  hintOptional?: boolean;
}

const EXPECTED: Record<string, Expectation> = {
  "missing-semicolon": {
    code: XppErrorCodes.ExpectedToken,
    line: 2,
    contains: "expected ';'",
  },
  "unclosed-brace": {
    // Reported at the end of the code, which is where the missing '}' is noticed.
    code: XppErrorCodes.ExpectedToken,
    line: 3,
    contains: "expected '}'",
  },
  "stray-closing-brace": {
    code: XppErrorCodes.ExpectedExpression,
    line: 2,
    contains: "expected an expression",
  },
  "unterminated-string": {
    code: XppErrorCodes.UnterminatedString,
    line: 1,
    contains: "unterminated string",
  },
  "unexpected-character": {
    code: XppErrorCodes.UnexpectedCharacter,
    line: 2,
    contains: "unexpected character",
  },
  "unterminated-block-comment": {
    code: XppErrorCodes.UnterminatedComment,
    line: 2,
    contains: "unterminated block comment",
  },
  "macro-directive": {
    code: XppErrorCodes.ConstructOutsideSubset,
    line: 1,
    contains: "macros and preprocessor directives",
  },
  "missing-expression": {
    code: XppErrorCodes.ExpectedExpression,
    line: 1,
    contains: "expected an expression",
  },
  "missing-closing-paren": {
    code: XppErrorCodes.ExpectedToken,
    line: 2,
    contains: "expected ')'",
  },
  "select-without-buffer": {
    code: XppErrorCodes.ExpectedToken,
    line: 1,
    contains: "expected a name",
  },
  "forceliterals-out-of-subset": {
    code: XppErrorCodes.ConstructOutsideSubset,
    line: 2,
    contains: "forceliterals",
  },
  "record-sorted-list-out-of-subset": {
    code: XppErrorCodes.ConstructOutsideSubset,
    line: 3,
    contains: "recordsortedlist",
  },
  "invalid-numeric-literal": {
    code: XppErrorCodes.InvalidNumericLiteral,
    line: 1,
    contains: "decimal point",
  },
  "missing-condition": {
    code: XppErrorCodes.ExpectedExpression,
    line: 1,
    contains: "expected an expression",
  },
};

const snippets = errorSnippets();

describe("broken snippets", () => {
  it("has an expectation for every snippet in the corpus", () => {
    expect(snippets.map((s) => s.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(snippets.map((snippet) => [snippet.name, snippet] as const))(
    "%s reports the expected error",
    (name, snippet) => {
      const expectation = EXPECTED[name]!;
      const { errors } = parse(snippet.source);

      expect(errors.length, `${name} should produce at least one error`).toBeGreaterThan(0);

      const first = errors[0]!;
      expect({ code: first.code, line: first.line }).toEqual({
        code: expectation.code,
        line: expectation.line,
      });
      expect(first.message.toLowerCase()).toContain(expectation.contains);
    },
  );

  it.each(snippets.map((snippet) => [snippet.name, snippet] as const))(
    "%s carries a teaching hint",
    (name, snippet) => {
      if (EXPECTED[name]?.hintOptional) return;
      const { errors } = parse(snippet.source);
      const first = errors[0]!;
      // A learner-facing error without a hint is a bug, not a style preference.
      expect({ name, hasHint: (first.hint?.length ?? 0) > 10 }).toEqual({ name, hasHint: true });
    },
  );

  it("never throws, whatever it is given", () => {
    const nasty = ["", "   ", "}", ";;;;", "select", "((((", '"', "\\", "if if if", "1 + + +"];
    for (const source of nasty) {
      expect(() => parse(source), `parse(${JSON.stringify(source)})`).not.toThrow();
    }
  });

  it("stops after maxErrors rather than producing a wall of red", () => {
    const source = Array.from({ length: 200 }, () => "int = ;").join("\n");
    const { errors } = parse(source, { maxErrors: 5 });
    expect(errors.length).toBeLessThanOrEqual(5);
  });

  it("recovers far enough to report more than one problem", () => {
    const source = ["int a = ;", 'info("fine");', "int b = ;"].join("\n");
    const { errors } = parse(source);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0]!.line).toBe(1);
    expect(errors.at(-1)!.line).toBe(3);
  });
});
