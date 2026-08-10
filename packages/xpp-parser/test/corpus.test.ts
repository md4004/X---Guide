/**
 * The fixture corpus — Phase 2's acceptance criterion.
 *
 * Every snippet in fixtures/valid.xpp must parse with zero errors, and its AST is
 * committed as a golden file under fixtures/expected/. Reviewing those files is how the
 * corpus proves the parser produces the *expected* tree rather than merely a tree.
 *
 * Structural assertions that matter semantically — precedence, select clause shapes,
 * transaction nesting — are asserted directly in the sibling test files, because a
 * snapshot diff is easy to wave through and an assertion is not.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parse } from "../src/index.js";
import { errorSnippets, validSnippets } from "../fixtures/load.js";

const valid = validSnippets();
const broken = errorSnippets();

/** Spans are noise in a golden file and change with every whitespace edit. */
function stripSpans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSpans);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "span")
        .map(([key, inner]) => [key, stripSpans(inner)]),
    );
  }
  return value;
}

describe("corpus size", () => {
  it("has at least 40 valid snippets, as Phase 2 requires", () => {
    expect(valid.length).toBeGreaterThanOrEqual(40);
  });

  it("has at least 10 deliberately broken snippets", () => {
    expect(broken.length).toBeGreaterThanOrEqual(10);
  });

  it("gives every snippet a unique name", () => {
    const names = valid.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("valid snippets", () => {
  it.each(valid.map((snippet) => [snippet.name, snippet] as const))(
    "%s parses without errors",
    (name, snippet) => {
      const result = parse(snippet.source);
      expect(
        { name, errors: result.errors.map((e) => `${e.code} ${e.message}`) },
        `${name} should parse cleanly`,
      ).toEqual({ name, errors: [] });
      expect(result.ast).not.toBeNull();
    },
  );

  it.each(valid.map((snippet) => [snippet.name, snippet] as const))(
    "%s matches its golden AST",
    async (name, snippet) => {
      const { ast } = parse(snippet.source);
      await expect(JSON.stringify(stripSpans(ast), null, 2)).toMatchFileSnapshot(
        fileURLToPath(new URL(`../fixtures/expected/${name}.json`, import.meta.url)),
      );
    },
  );

  it("produces a source unit that contains something for every snippet", () => {
    for (const snippet of valid) {
      const { ast } = parse(snippet.source);
      const produced = (ast?.statements.length ?? 0) + (ast?.declarations.length ?? 0);
      expect({ name: snippet.name, produced: produced > 0 }).toEqual({
        name: snippet.name,
        produced: true,
      });
    }
  });
});

describe("every span is well formed", () => {
  it.each(valid.map((snippet) => [snippet.name, snippet] as const))(
    "%s has spans that start before they end",
    (_name, snippet) => {
      const { ast } = parse(snippet.source);
      const seen: string[] = [];

      const check = (value: unknown, path: string): void => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => check(item, `${path}[${index}]`));
          return;
        }
        if (value === null || typeof value !== "object") return;

        const node = value as { kind?: string; span?: { start: unknown; end: unknown } };
        if (typeof node.kind === "string" && node.span) {
          const span = node.span as {
            start: { offset: number; line: number };
            end: { offset: number };
          };
          if (span.end.offset < span.start.offset) seen.push(`${path} (${node.kind})`);
          if (span.start.line < 1) seen.push(`${path} (${node.kind}) has line < 1`);
        }

        for (const [key, inner] of Object.entries(value)) {
          if (key === "span") continue;
          check(inner, `${path}.${key}`);
        }
      };

      check(ast, "ast");
      expect(seen).toEqual([]);
    },
  );
});
