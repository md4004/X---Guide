/**
 * The validator primitives, tested away from any lesson.
 *
 * `lesson.test.ts` proves the real authored lesson works end to end. These prove each
 * assertion kind in isolation, so a failure points at a rule rather than at content.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "@xpplab/xpp-parser";
import type { SourceUnit } from "@xpplab/xpp-parser";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "@xpplab/xpp-runtime";
import { evaluateAst, evaluateOutput, evaluateSql, evaluateState } from "../src/index";
import type { AstValidator, OutputValidator, SqlValidator, StateValidator } from "../src/index";

const astOf = (source: string): SourceUnit => {
  const { ast, errors } = parse(source);
  expect(errors, source).toEqual([]);
  return ast!;
};

const ast = (rule: AstValidator["rule"], value: string): AstValidator =>
  ({ kind: "ast", rule, value, message: "x".repeat(30) }) as AstValidator;

describe("ast validators", () => {
  it("usesStatement finds a statement anywhere in the tree", () => {
    const unit = astOf(`InventTable i;\nif (1) { while select i { info(i.ItemId); } }`);
    expect(evaluateAst(ast("usesStatement", "whileSelect"), unit)).toBe(true);
    expect(evaluateAst(ast("usesStatement", "tryCatch"), unit)).toBe(false);
  });

  it("forbids is the inverse", () => {
    const unit = astOf(`InventTable i;\nwhile select i { info(i.ItemId); }`);
    expect(evaluateAst(ast("forbids", "whileSelect"), unit)).toBe(false);
    expect(evaluateAst(ast("forbids", "tryCatch"), unit)).toBe(true);
  });

  it("usesModifier looks at every select in the program", () => {
    const unit = astOf(`InventTable i;\nselect i;\nselect forupdate i;`);
    expect(evaluateAst(ast("usesModifier", "forupdate"), unit)).toBe(true);
    expect(evaluateAst(ast("usesModifier", "crosscompany"), unit)).toBe(false);
  });

  it("callsMethod finds a buffer method", () => {
    const unit = astOf(`InventTable i;\nttsbegin;\nselect forupdate i;\ni.update();\nttscommit;`);
    expect(evaluateAst(ast("callsMethod", "update"), unit)).toBe(true);
    expect(evaluateAst(ast("callsMethod", "insert"), unit)).toBe(false);
  });

  it("callsMethod finds a global function too", () => {
    expect(evaluateAst(ast("callsMethod", "strFmt"), astOf(`info(strFmt("%1", 1));`))).toBe(true);
  });

  it("callsMethod finds a Chain of Command next", () => {
    const unit = astOf(
      `[ExtensionOf(tableStr(InventTable))]\nfinal class E { public void insert() { next insert(); } }`,
    );
    expect(evaluateAst(ast("callsMethod", "next"), unit)).toBe(true);
  });

  it("declaresExtension reads the attribute's target", () => {
    const unit = astOf(
      `[ExtensionOf(tableStr(InventTable))]\nfinal class E { public void insert() { next insert(); } }`,
    );
    expect(evaluateAst(ast("declaresExtension", "InventTable"), unit)).toBe(true);
    expect(evaluateAst(ast("declaresExtension", "CustTable"), unit)).toBe(false);
  });
});

describe("wrappedIn: transaction", () => {
  const wrapped = ast("wrappedIn", "transaction");

  it("passes when the write is inside ttsbegin/ttscommit", () => {
    const unit = astOf(`InventTable i;\nttsbegin;\nselect forupdate i;\ni.update();\nttscommit;`);
    expect(evaluateAst(wrapped, unit)).toBe(true);
  });

  it("fails when the write is outside", () => {
    const unit = astOf(`InventTable i;\nselect forupdate i;\ni.update();`);
    expect(evaluateAst(wrapped, unit)).toBe(false);
  });

  it("requires *every* write to be wrapped, not just one", () => {
    // Half-covered is not understood. Passing this would teach that it is.
    const unit = astOf(`InventTable i;\nttsbegin;\ni.update();\nttscommit;\ni.update();`);
    expect(evaluateAst(wrapped, unit)).toBe(false);
  });

  it("sees a write nested inside a loop inside the transaction", () => {
    const unit = astOf(
      `InventTable i;\nttsbegin;\nwhile select forupdate i { i.update(); }\nttscommit;`,
    );
    expect(evaluateAst(wrapped, unit)).toBe(true);
  });

  it("covers set-based statements as well as buffer methods", () => {
    expect(
      evaluateAst(wrapped, astOf(`InventTable i;\nttsbegin;\ndelete_from i;\nttscommit;`)),
    ).toBe(true);
    expect(evaluateAst(wrapped, astOf(`InventTable i;\ndelete_from i;`))).toBe(false);
  });

  it("fails when there is nothing to wrap, because nothing was written", () => {
    expect(evaluateAst(wrapped, astOf(`info("no writes here");`))).toBe(false);
  });
});

describe("output validators", () => {
  const infolog = [
    { type: "info" as const, message: "Blocked 4 items", sequence: 0 },
    { type: "warning" as const, message: "careful", sequence: 1 },
  ];

  const output = (extra: Partial<OutputValidator>): OutputValidator =>
    ({
      kind: "output",
      match: "^Blocked \\d+ items$",
      message: "x".repeat(30),
      ...extra,
    }) as OutputValidator;

  it("matches an anchored pattern", () => {
    expect(evaluateOutput(output({}), infolog).passed).toBe(true);
  });

  it("respects the type filter", () => {
    expect(evaluateOutput(output({ type: "info" }), infolog).passed).toBe(true);
    expect(evaluateOutput(output({ type: "error" }), infolog).passed).toBe(false);
  });

  it("inverts on negate", () => {
    expect(evaluateOutput(output({ negate: true }), infolog).passed).toBe(false);
    expect(evaluateOutput(output({ match: "nope", negate: true }), infolog).passed).toBe(true);
  });

  it("reports an invalid pattern as an authoring error, not a learner failure", () => {
    const result = evaluateOutput(output({ match: "(" }), infolog);
    expect(result.passed).toBe(false);
    expect(result.detail["authoringError"]).toContain("not a valid regex");
  });

  it("returns what it saw, so the author can debug a near miss", () => {
    const result = evaluateOutput(output({ match: "^Blocked 5 items$" }), infolog);
    expect(result.detail["messagesSeen"]).toContain("Blocked 4 items");
  });
});

describe("sql validators", () => {
  const trace = [
    {
      sequence: 0,
      kind: "savepoint" as const,
      sql: "SAVEPOINT tts_1",
      parameters: [],
      rowCount: 0,
      transactionDepth: 1,
    },
    {
      sequence: 1,
      kind: "select" as const,
      sql: "SELECT a FROM InventTable",
      parameters: [],
      rowCount: 4,
      transactionDepth: 1,
    },
    {
      sequence: 2,
      kind: "update" as const,
      sql: "UPDATE InventTable SET x = ?",
      parameters: [1],
      rowCount: 4,
      transactionDepth: 1,
    },
    {
      sequence: 3,
      kind: "release" as const,
      sql: "RELEASE SAVEPOINT tts_1",
      parameters: [],
      rowCount: 0,
      transactionDepth: 0,
    },
  ];

  const sql = (rule: SqlValidator["rule"], value: number | string): SqlValidator =>
    ({ kind: "sql", rule, value, message: "x".repeat(30) }) as SqlValidator;

  it("does not count savepoints as statements", () => {
    // Otherwise maxStatements would depend on how the learner nested transactions
    // rather than on how many times they hit the database.
    expect(evaluateSql(sql("maxStatements", 2), trace).passed).toBe(true);
    expect(evaluateSql(sql("maxStatements", 1), trace).passed).toBe(false);
  });

  it("enforces a minimum too", () => {
    expect(evaluateSql(sql("minStatements", 2), trace).passed).toBe(true);
    expect(evaluateSql(sql("minStatements", 3), trace).passed).toBe(false);
  });

  it("matches and forbids by pattern, case-insensitively", () => {
    expect(evaluateSql(sql("matches", "update inventtable"), trace).passed).toBe(true);
    expect(evaluateSql(sql("forbids", "update inventtable"), trace).passed).toBe(false);
    expect(evaluateSql(sql("forbids", "DELETE"), trace).passed).toBe(true);
  });

  it("reports the actual count so the failure explains itself", () => {
    expect(evaluateSql(sql("maxStatements", 1), trace).detail["actual"]).toBe(2);
  });
});

describe("state validators", () => {
  let db: VirtualDb;

  beforeEach(async () => {
    db = createVirtualDb();
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  const state = (extra: Partial<StateValidator>): StateValidator =>
    ({ kind: "state", table: "InventTable", message: "x".repeat(30), ...extra }) as StateValidator;

  it("counts rows", async () => {
    const result = await evaluateState(
      state({ where: { ItemGroupId: "FURNITURE" }, count: 4 }),
      db,
    );
    expect(result.passed).toBe(true);
  });

  it("checks field values across every matching row by default", async () => {
    await runSource({
      source: `InventTable i;\nttsbegin;\nupdate_recordset i setting Blocked = NoYes::Yes where i.ItemGroupId == "FURNITURE";\nttscommit;`,
      db,
    });

    const result = await evaluateState(
      state({ where: { ItemGroupId: "FURNITURE" }, expect: { Blocked: 1 } }),
      db,
    );
    expect(result.passed).toBe(true);
  });

  it("fails when only some rows satisfy the expectation", async () => {
    const result = await evaluateState(
      state({ where: { ItemGroupId: "FURNITURE" }, expect: { Blocked: 1 } }),
      db,
    );
    // One of the four is already blocked in the seed, so this is a partial match.
    expect(result.passed).toBe(false);
    expect(result.detail["satisfyingRows"]).toBe(1);
    expect(result.detail["matchedRows"]).toBe(4);
  });

  it("accepts a partial match when all is false", async () => {
    const result = await evaluateState(
      state({ where: { ItemGroupId: "FURNITURE" }, expect: { Blocked: 1 }, all: false }),
      db,
    );
    expect(result.passed).toBe(true);
  });

  it("distinguishes 'no rows matched' from 'wrong values'", async () => {
    const result = await evaluateState(
      state({ where: { ItemGroupId: "NOSUCHGROUP" }, expect: { Blocked: 1 } }),
      db,
    );
    expect(result.passed).toBe(false);
    expect(result.detail["reason"]).toBe("no rows matched");
  });

  it("compares field names case-insensitively, as X++ does", async () => {
    const result = await evaluateState(
      state({ where: { itemgroupid: "FURNITURE" }, count: 4 }),
      db,
    );
    expect(result.passed).toBe(true);
  });

  it("compares an enum against its stored integer", async () => {
    // The lesson writes NoYes::Yes; SQLite hands back 1. A strict === would fail here
    // for a reason no author could see.
    const result = await evaluateState(
      state({ where: { ItemId: "F-102" }, expect: { Blocked: 1 } }),
      db,
    );
    expect(result.passed).toBe(true);
  });

  it("can look across companies", async () => {
    const scoped = await evaluateState(state({ where: { ItemId: "F-100" }, count: 1 }), db);
    const all = await evaluateState(
      state({ where: { ItemId: "F-100" }, count: 2, company: "all" }),
      db,
    );
    expect(scoped.passed).toBe(true);
    expect(all.passed).toBe(true);
  });
});
