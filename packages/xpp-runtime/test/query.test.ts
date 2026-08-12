/**
 * The Query object model (VB-051), and the range syntax that comes with it.
 *
 * The tests that matter most here are the ones asserting the **SQL**. A query object is
 * only worth teaching if a learner can see that it produces the same statement as the
 * `while select` they already know — and that it produces *one* statement for the whole
 * walk, not one per row.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { parseRangeValue, runSource } from "../src";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const run = (source: string) => runSource({ source, db });
const messages = async (source: string) =>
  (await run(source)).infolog.map((entry) => entry.message);

describe("range values", () => {
  // The documented advanced syntax. A developer who assumes a range means `==` writes
  // filters that quietly match nothing.
  it("reads the comparison out of the value", () => {
    expect(parseRangeValue("CC-100")).toEqual({ kind: "equals", value: "CC-100" });
    expect(parseRangeValue(">2")).toEqual({ kind: "compare", operator: ">", value: "2" });
    expect(parseRangeValue(">=10")).toEqual({ kind: "compare", operator: ">=", value: "10" });
    expect(parseRangeValue("F-100..F-200")).toEqual({
      kind: "between",
      from: "F-100",
      to: "F-200",
    });
    expect(parseRangeValue("F-1*")).toEqual({ kind: "like", pattern: "F-1*" });
  });

  it("treats an empty range as no restriction at all", () => {
    // Not "match nothing". This is the framework's behaviour and it surprises people.
    expect(parseRangeValue("   ")).toEqual({ kind: "empty" });
  });
});

describe("building and running a query", () => {
  it("walks a table and reads fields off the buffer it hands back", async () => {
    expect(
      await messages(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
QueryRun queryRun = new QueryRun(query);
InventTable inventTable;
int counter;

while (queryRun.next())
{
    inventTable = queryRun.get(tableNum(InventTable));
    counter++;
}

info(strFmt("%1 items", counter));
`),
    ).toEqual(["8 items"]);
  });

  it("applies a range as a where clause", async () => {
    expect(
      await messages(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
QueryBuildRange qbr = qbds.addRange(fieldNum(InventTable, ItemGroupId));
qbr.value("FURNITURE");

QueryRun queryRun = new QueryRun(query);
InventTable inventTable;
int counter;

while (queryRun.next())
{
    inventTable = queryRun.get(tableNum(InventTable));
    counter++;
}

info(strFmt("%1 furniture items", counter));
`),
    ).toEqual(["4 furniture items"]);
  });

  it("honours the advanced range syntax", async () => {
    expect(
      await messages(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
QueryBuildRange qbr = qbds.addRange(fieldNum(InventTable, StandardCost));
qbr.value(">200");

QueryRun queryRun = new QueryRun(query);
InventTable inventTable;
int counter;

while (queryRun.next())
{
    inventTable = queryRun.get(tableNum(InventTable));
    counter++;
}

info(strFmt("%1 above 200", counter));
`),
    ).toEqual(["2 above 200"]);
  });

  it("runs one statement for the whole walk, and it is a plain parameterised select", async () => {
    // The headline claim of the whole feature: a query object is a select you assembled,
    // not a different mechanism, and it does not degrade into a query per row.
    const result = await run(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
QueryBuildRange qbr = qbds.addRange(fieldNum(InventTable, ItemGroupId));
qbr.value("FURNITURE");
qbds.addSortField(fieldNum(InventTable, ItemId), SortOrder::Descending);

QueryRun queryRun = new QueryRun(query);
InventTable inventTable;

while (queryRun.next())
{
    inventTable = queryRun.get(tableNum(InventTable));
    info(inventTable.ItemId);
}
`);

    expect(result.errors).toEqual([]);
    expect(result.sqlTrace).toHaveLength(1);

    const sql = result.sqlTrace[0]!.sql;
    expect(sql).toContain("FROM InventTable");
    expect(sql).toContain("ORDER BY");
    // Company scoping comes from the shared compiler, so a query object gets it for free.
    expect(sql).toContain("DATAAREAID = ?");
    // Never inlined — the range value is bound, exactly as a hand-written where would be.
    expect(sql).not.toContain("FURNITURE");
    expect(result.sqlTrace[0]!.parameters).toContain("FURNITURE");

    expect(result.infolog.map((entry) => entry.message)).toEqual([
      "F-103",
      "F-102",
      "F-101",
      "F-100",
    ]);
  });

  it("finds a range that is already on the data source rather than adding a second", async () => {
    // The `findRange` / `addRange` pattern from the RDP walkthrough: a caller may already
    // have set the range, and clobbering it would throw away the user's filter.
    expect(
      await messages(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
qbds.addRange(fieldNum(InventTable, ItemGroupId)).value("FURNITURE");

QueryBuildDataSource again = query.dataSourceTable(tableNum(InventTable));
QueryBuildRange existing = again.findRange(fieldNum(InventTable, ItemGroupId));

info(existing.value());
`),
    ).toEqual(["FURNITURE"]);
  });
});

describe("what it refuses", () => {
  it("refuses a joined data source, and names the alternative", async () => {
    const result = await run(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(SalesTable));
QueryBuildDataSource child = qbds.addDataSource(tableNum(SalesLine));
`);

    expect(result.errors[0]?.message).toContain("not simulated");
    expect(result.errors[0]?.hint).toContain("while select");
  });

  it("refuses a query with no data source", async () => {
    const result = await run(`
Query query = new Query();
QueryRun queryRun = new QueryRun(query);
while (queryRun.next())
{
}
`);

    expect(result.errors[0]?.message).toContain("no data source");
  });

  it("catches a mistyped table at the point a real compiler would", async () => {
    const result = await run(
      `Query query = new Query();\nquery.addDataSource(tableNum(NoSuchTable));`,
    );
    expect(result.errors[0]?.message).toContain("no table called 'NoSuchTable'");
  });

  it("catches a mistyped field the same way", async () => {
    const result = await run(`
Query query = new Query();
QueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));
qbds.addRange(fieldNum(InventTable, NoSuchField));
`);
    expect(result.errors[0]?.message).toContain("no field called 'NoSuchField'");
  });
});
