/**
 * The parser's public surface, and the traversal that `ast` validators run on.
 */

import { describe, expect, it } from "vitest";
import { findAll, isInsideTransaction, parse, parseExpression, walk } from "../src/index.js";
import type { NodeKind, SourceUnit, Statement } from "../src/index.js";

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
  "nextCall",
] as const satisfies readonly NodeKind[];

const unitOf = (source: string): SourceUnit => {
  const { ast, errors } = parse(source);
  expect(errors).toEqual([]);
  expect(ast).not.toBeNull();
  return ast!;
};

describe("validator-facing node kinds", () => {
  it("keeps the contractual kinds stable", () => {
    expect(CONTRACTUAL_KINDS).toHaveLength(11);
  });

  it.each(CONTRACTUAL_KINDS)("%s is reachable from a real snippet", (kind) => {
    const sources: Record<string, string> = {
      whileSelect: "CustTable c;\nwhile select c { info(c.AccountNum); }",
      select: "CustTable c;\nselect firstonly c;",
      insertRecordset:
        "InventTable s;\nInventTable t;\ninsert_recordset t (ItemId) select ItemId from s;",
      updateRecordset: "InventTable i;\nupdate_recordset i setting Blocked = 1;",
      deleteFrom: "InventTable i;\ndelete_from i;",
      tryCatch: 'try { info("a"); } catch { info("b"); }',
      ttsBegin: "ttsbegin;\nttscommit;",
      ttsCommit: "ttsbegin;\nttscommit;",
      ttsAbort: "ttsbegin;\nttsabort;",
      changeCompany: 'changecompany ("KELT") { info("x"); }',
      nextCall:
        "[ExtensionOf(tableStr(InventTable))]\nfinal class E { public void insert() { next insert(); } }",
    };
    expect(findAll(unitOf(sources[kind]!), kind).length).toBeGreaterThan(0);
  });
});

describe("walk", () => {
  it("visits every node, including deeply nested expressions", () => {
    const unit = unitOf("int a = 1 + 2 * 3;");
    const kinds: string[] = [];
    walk(unit, { "*": { enter: (node) => void kinds.push(node.kind) } });

    expect(kinds).toContain("sourceUnit");
    expect(kinds).toContain("variableDeclaration");
    expect(kinds).toContain("binary");
    expect(kinds.filter((k) => k === "literal")).toHaveLength(3);
  });

  it("calls exit after the children", () => {
    const unit = unitOf('if (a) { info("x"); }');
    const order: string[] = [];
    walk(unit, {
      if: {
        enter: () => void order.push("enter-if"),
        exit: () => void order.push("exit-if"),
      },
      call: { enter: () => void order.push("enter-call") },
    });
    expect(order).toEqual(["enter-if", "enter-call", "exit-if"]);
  });

  it("prunes the subtree when enter returns false", () => {
    const unit = unitOf('if (a) { info("x"); }');
    const kinds: string[] = [];
    walk(unit, {
      if: { enter: () => false },
      "*": { enter: (node) => void kinds.push(node.kind) },
    });
    expect(kinds).not.toContain("call");
  });

  it("visits children in source order", () => {
    const unit = unitOf('info("one");\ninfo("two");\ninfo("three");');
    const texts: string[] = [];
    walk(unit, {
      literal: {
        enter: (node) => {
          if (node.literalType === "str") texts.push(String(node.value));
        },
      },
    });
    expect(texts).toEqual(["one", "two", "three"]);
  });
});

describe("isInsideTransaction", () => {
  const statementAt = (unit: SourceUnit, kind: NodeKind): Statement =>
    findAll(unit, kind)[0] as Statement;

  it("is true for a statement between ttsbegin and ttscommit", () => {
    const unit = unitOf("ttsbegin;\nInventTable i;\ndelete_from i;\nttscommit;");
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(true);
  });

  it("is false for a statement before the transaction", () => {
    const unit = unitOf("InventTable i;\ndelete_from i;\nttsbegin;\nttscommit;");
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(false);
  });

  it("is false for a statement after the transaction", () => {
    const unit = unitOf("ttsbegin;\nttscommit;\nInventTable i;\ndelete_from i;");
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(false);
  });

  it("sees through a loop body, which is where the real lesson lives", () => {
    const unit = unitOf(
      "InventTable i;\nttsbegin;\nwhile select forupdate i\n{\n    i.update();\n}\nttscommit;",
    );
    expect(isInsideTransaction(unit, statementAt(unit, "whileSelect"))).toBe(true);
  });

  it("stays true at nesting depth two", () => {
    const unit = unitOf(
      "ttsbegin;\nttsbegin;\nInventTable i;\ndelete_from i;\nttscommit;\nttscommit;",
    );
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(true);
  });

  it("treats ttsabort as closing the transaction", () => {
    const unit = unitOf("ttsbegin;\nttsabort;\nInventTable i;\ndelete_from i;");
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(false);
  });

  it("is false when there is no transaction at all", () => {
    const unit = unitOf("InventTable i;\ndelete_from i;");
    expect(isInsideTransaction(unit, statementAt(unit, "deleteFrom"))).toBe(false);
  });
});

describe("parseExpression", () => {
  it("parses a bare expression", () => {
    const expression = parseExpression("a + b");
    expect(expression?.kind).toBe("binary");
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(parseExpression("+")).toBeNull();
  });
});
