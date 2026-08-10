/**
 * The select→SQL compiler.
 *
 * Tested on its own because its output is a learner-facing feature, not an
 * implementation detail. When someone asks "why did my loop run 400 statements", the
 * answer is what this produces.
 *
 * Two properties are non-negotiable and asserted throughout: company scoping is applied
 * unless `crosscompany` was written, and parameter values are never inlined.
 */

import { describe, expect, it } from "vitest";
import { parse } from "@xpplab/xpp-parser";
import type { SelectClauses, Statement } from "@xpplab/xpp-parser";
import { isCompiled, selectToSql } from "../src/index.js";
import type { TableName } from "../src/index.js";

/** Buffer declarations the snippets below use. */
const BUFFERS: Record<string, TableName> = {
  custTable: "CustTable",
  custTrans: "CustTrans",
  inventTable: "InventTable",
  salesTable: "SalesTable",
  salesLine: "SalesLine",
  dirPartyTable: "DirPartyTable",
};

function clausesOf(source: string): SelectClauses {
  const { ast, errors } = parse(source);
  expect(errors, `parse errors in: ${source}`).toEqual([]);

  const statement = ast!.statements.find(
    (candidate): candidate is Extract<Statement, { kind: "select" | "whileSelect" }> =>
      candidate.kind === "select" || candidate.kind === "whileSelect",
  );
  expect(statement, `no select found in: ${source}`).toBeDefined();
  return statement!.clauses;
}

function compile(source: string, company = "HVND") {
  const result = selectToSql(clausesOf(source), {
    company,
    resolveBuffer: (name) => BUFFERS[name],
  });
  if (!isCompiled(result)) {
    throw new Error(
      `expected a compile, got errors: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result;
}

function compileErrors(source: string) {
  const result = selectToSql(clausesOf(source), {
    company: "HVND",
    resolveBuffer: (name) => BUFFERS[name],
  });
  if (isCompiled(result)) throw new Error("expected errors, got a compiled statement");
  return result.errors;
}

describe("company scoping", () => {
  it("adds a DATAAREAID predicate to a company-scoped table", () => {
    const { sql, parameters } = compile("CustTable custTable;\nselect custTable;");
    expect(sql).toContain("t0.DATAAREAID = ?");
    expect(parameters).toEqual(["HVND"]);
  });

  it("omits it for crosscompany, which is the whole point of the modifier", () => {
    const { sql, parameters } = compile("CustTable custTable;\nselect crosscompany custTable;");
    expect(sql).not.toContain("DATAAREAID = ?");
    expect(parameters).toEqual([]);
  });

  it("omits it for a shared table, which has no company", () => {
    const { sql } = compile("DirPartyTable dirPartyTable;\nselect dirPartyTable;");
    expect(sql).not.toContain("DATAAREAID = ?");
  });

  it("scopes every joined table, not only the first", () => {
    const { parameters } = compile(`
SalesTable salesTable;
SalesLine salesLine;
while select salesTable join salesLine where salesLine.SalesId == salesTable.SalesId {}
`);
    // One for the root, one for the join.
    expect(parameters.filter((value) => value === "HVND")).toHaveLength(2);
  });

  it("uses the company it was given, not a default", () => {
    const { parameters } = compile("CustTable custTable;\nselect custTable;", "MRDA");
    expect(parameters).toEqual(["MRDA"]);
  });
});

describe("parameterisation", () => {
  it("never inlines a literal", () => {
    const { sql, parameters } = compile(`
CustTable custTable;
select custTable where custTable.AccountNum == "C-1000";
`);
    expect(sql).not.toContain("C-1000");
    expect(sql).toContain("?");
    expect(parameters).toContain("C-1000");
  });

  it("passes an enum through as its stored ordinal", () => {
    const { parameters } = compile(`
InventTable inventTable;
select inventTable where inventTable.Blocked == NoYes::Yes;
`);
    expect(parameters).toContain(1);
  });

  it("orders parameters to match the placeholders", () => {
    const { sql, parameters } = compile(`
InventTable inventTable;
select inventTable where inventTable.ItemGroupId == "FURNITURE" && inventTable.ItemId == "F-100";
`);
    const placeholders = (sql.match(/\?/g) ?? []).length;
    expect(parameters).toHaveLength(placeholders);
    expect(parameters).toEqual(["FURNITURE", "F-100", "HVND"]);
  });
});

describe("field lists", () => {
  it("selects every column when none is named", () => {
    const { outputs } = compile("CustTable custTable;\nselect custTable;");
    expect(outputs["custTable"]).toContain("AccountNum");
    expect(outputs["custTable"]).toContain("RECID");
    expect(outputs["custTable"]).toContain("DATAAREAID");
  });

  it("selects only the named columns", () => {
    const { outputs, sql } = compile(`
CustTable custTable;
while select AccountNum, CreditMax from custTable {}
`);
    expect(outputs["custTable"]).toEqual(["AccountNum", "CreditMax"]);
    expect(sql).toContain("t0.AccountNum, t0.CreditMax");
  });

  it("resolves a field name case-insensitively", () => {
    const { outputs } = compile(`
CustTable custTable;
while select accountnum from custTable {}
`);
    expect(outputs["custTable"]).toEqual(["AccountNum"]);
  });

  it("compiles aggregates to their SQL equivalents", () => {
    const { sql } = compile(`
CustTrans custTrans;
while select sum(AmountMST) from custTrans group by custTrans.AccountNum {}
`);
    expect(sql).toContain("SUM(t0.AmountMST)");
    expect(sql).toContain("GROUP BY t0.AccountNum");
  });

  it("maps minof and maxof to MIN and MAX", () => {
    const { sql } = compile(`
CustTrans custTrans;
select minof(AmountMST), maxof(AmountMST) from custTrans;
`);
    expect(sql).toContain("MIN(t0.AmountMST)");
    expect(sql).toContain("MAX(t0.AmountMST)");
  });
});

describe("joins", () => {
  it("compiles a plain join to INNER JOIN", () => {
    const { sql } = compile(`
SalesTable salesTable;
SalesLine salesLine;
while select salesTable join salesLine where salesLine.SalesId == salesTable.SalesId {}
`);
    expect(sql).toContain("INNER JOIN SalesLine AS t1 ON");
  });

  it("compiles outer join to LEFT OUTER JOIN", () => {
    const { sql } = compile(`
CustTable custTable;
CustTrans custTrans;
while select custTable outer join custTrans where custTrans.AccountNum == custTable.AccountNum {}
`);
    expect(sql).toContain("LEFT OUTER JOIN CustTrans AS t1 ON");
  });

  it("compiles exists join to an EXISTS subquery, not a join", () => {
    // A real join would duplicate outer rows; EXISTS is why it does not.
    const { sql } = compile(`
CustTable custTable;
SalesTable salesTable;
while select custTable exists join salesTable where salesTable.CustAccount == custTable.AccountNum {}
`);
    expect(sql).toContain("EXISTS (SELECT 1 FROM SalesTable");
    expect(sql).not.toContain("INNER JOIN SalesTable");
  });

  it("compiles notexists join to NOT EXISTS", () => {
    const { sql } = compile(`
CustTable custTable;
SalesTable salesTable;
while select custTable notexists join salesTable where salesTable.CustAccount == custTable.AccountNum {}
`);
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM SalesTable");
  });

  it("gives an exists join no output columns", () => {
    const { outputs } = compile(`
CustTable custTable;
SalesTable salesTable;
while select custTable exists join salesTable where salesTable.CustAccount == custTable.AccountNum {}
`);
    expect(Object.keys(outputs)).toEqual(["custTable"]);
  });
});

describe("modifiers", () => {
  it("turns firstonly into LIMIT 1", () => {
    expect(compile("CustTable custTable;\nselect firstonly custTable;").sql).toContain("LIMIT 1");
  });

  it("turns firstonly10 into LIMIT 10", () => {
    expect(compile("CustTable custTable;\nselect firstonly10 custTable;").sql).toContain(
      "LIMIT 10",
    );
  });

  it("reports forupdate so the interpreter can mark the buffer writable", () => {
    expect(compile("CustTable custTable;\nselect forupdate custTable;").forUpdate).toBe(true);
    expect(compile("CustTable custTable;\nselect custTable;").forUpdate).toBe(false);
  });

  it("compiles order by with direction", () => {
    const { sql } = compile(`
CustTrans custTrans;
while select custTrans order by custTrans.TransDate desc {}
`);
    expect(sql).toContain("ORDER BY t0.TransDate DESC");
  });

  it("flips the sort for reverse rather than adding a second one", () => {
    const { sql } = compile(`
CustTrans custTrans;
while select reverse custTrans order by custTrans.TransDate asc {}
`);
    expect(sql).toContain("ORDER BY t0.TransDate DESC");
    expect(sql.match(/ORDER BY/g)).toHaveLength(1);
  });
});

describe("like", () => {
  it("translates X++ wildcards to SQL ones", () => {
    // `*` means many and `?` means one in X++; SQL wants `%` and `_`.
    const { parameters } = compile(`
InventTable inventTable;
select inventTable where inventTable.ItemId like "F-1*";
`);
    expect(parameters).toContain("F-1%");
  });

  it("translates the single-character wildcard", () => {
    const { parameters } = compile(`
InventTable inventTable;
select inventTable where inventTable.ItemId like "F-10?";
`);
    expect(parameters).toContain("F-10_");
  });

  it("escapes a literal percent so it is not treated as a wildcard", () => {
    const { parameters } = compile(`
InventTable inventTable;
select inventTable where inventTable.ItemName like "50%";
`);
    expect(parameters).toContain("50\\%");
  });
});

describe("rejections", () => {
  it("refuses an undeclared buffer, naming it", () => {
    const errors = compileErrors("select nosuchbuffer;");
    expect(errors[0]?.message).toContain("nosuchbuffer");
    expect(errors[0]?.hint).toContain("Declare it first");
  });

  it("refuses a field the table does not have, and lists some that it does", () => {
    const errors = compileErrors(`
CustTable custTable;
select custTable where custTable.NoSuchField == "x";
`);
    expect(errors[0]?.message).toContain("NoSuchField");
    expect(errors[0]?.hint).toContain("AccountNum");
  });

  it("refuses a method call in a where, explaining why", () => {
    const errors = compileErrors(`
InventTable inventTable;
select inventTable where strLen(inventTable.ItemId) > 3;
`);
    expect(errors[0]?.hint).toContain("becomes SQL");
  });

  it("carries a hint on every rejection", () => {
    const sources = [
      "select nosuchbuffer;",
      'CustTable custTable;\nselect custTable where custTable.Nope == "x";',
      "InventTable inventTable;\nselect inventTable where strLen(inventTable.ItemId) > 3;",
    ];
    for (const source of sources) {
      const errors = compileErrors(source);
      expect({ source, hasHint: (errors[0]?.hint?.length ?? 0) > 10 }).toEqual({
        source,
        hasHint: true,
      });
    }
  });
});
