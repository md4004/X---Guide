/**
 * The report chain: contract → data provider → controller (VB-047 to VB-050).
 *
 * The point of running this rather than describing it is the **sequence**. A learner
 * writes three classes and never writes the code that connects them; the framework does
 * that, in an order they do not choose, using the attributes as the wiring. These tests
 * pin that order, because getting it wrong is how you end up with a provider that runs
 * before its parameters arrive.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "../src";

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

/** The three classes a real RDP report is made of, in their smallest honest form. */
const CHAIN = `
[DataContractAttribute]
class ItemSalesContract
{
    private str itemGroup;

    [DataMemberAttribute("ItemGroup")]
    public str parmItemGroup(str _itemGroup = itemGroup)
    {
        itemGroup = _itemGroup;
        return itemGroup;
    }
}

class ItemSalesDP extends SRSReportDataProviderBase
{
    private TmpItemSales tmpItemSales;

    [SRSReportDataSetAttribute("ItemSales")]
    public TmpItemSales getItemSales()
    {
        info("The design asked for the dataset.");
        return tmpItemSales;
    }

    public void processReport()
    {
        SalesLine salesLine;
        InventTable inventTable;

        ttsbegin;
        while select salesLine
            join inventTable
            where inventTable.ItemId == salesLine.ItemId
        {
            tmpItemSales.clear();
            tmpItemSales.ItemGroupId = inventTable.ItemGroupId;
            tmpItemSales.ItemId = inventTable.ItemId;
            tmpItemSales.ItemName = inventTable.ItemName;
            tmpItemSales.SalesQty = salesLine.SalesQty;
            tmpItemSales.LineAmount = salesLine.LineAmount;
            tmpItemSales.insert();
        }
        ttscommit;
    }
}
`;

const RUN_IT = `
SrsReportRunController controller = new SrsReportRunController();
controller.parmReportName("ItemSalesReport.Report");
controller.startOperation();
`;

describe("running a report through its controller", () => {
  it("resolves the provider from the report and calls processReport", async () => {
    const logged = await messages(CHAIN + RUN_IT);

    expect(logged).toContain("The design asked for the dataset.");
    expect(logged).toContain(
      "Report ItemSalesReport ran: ItemSalesDP.processReport() filled TmpItemSales.",
    );
  });

  it("fills the table the design reads", async () => {
    await run(CHAIN + RUN_IT);

    const rows = await db.readRows("TmpItemSales");
    expect(rows).toHaveLength(6);
  });

  it("calls the dataset getter after processReport, not before", async () => {
    // The order is the whole lesson. A getter that ran first would return an empty table,
    // and the report would be blank for reasons nothing in the learner's code explains.
    const logged = await messages(
      CHAIN.replace(
        "        ttscommit;",
        '        ttscommit;\n        info("processReport finished.");',
      ) + RUN_IT,
    );

    expect(logged.indexOf("processReport finished.")).toBeLessThan(
      logged.indexOf("The design asked for the dataset."),
    );
  });

  it("hands the provider the query the report declares", async () => {
    const logged = await messages(
      `
class ItemSalesDP extends SRSReportDataProviderBase
{
    public void processReport()
    {
        Query given = this.parmQuery();

        if (given)
        {
            info("The framework supplied a query before processReport ran.");
        }
    }
}
` + RUN_IT,
    );

    expect(logged).toContain("The framework supplied a query before processReport ran.");
  });
});

describe("what the framework refuses", () => {
  it("refuses to start without a report name", async () => {
    const result = await run(
      "SrsReportRunController controller = new SrsReportRunController();\ncontroller.startOperation();",
    );

    expect(result.errors[0]?.message).toContain("no report name");
    expect(result.errors[0]?.hint).toContain("parmReportName");
  });

  it("names the report when there is no such element", async () => {
    const result = await run(`
SrsReportRunController controller = new SrsReportRunController();
controller.parmReportName("NoSuchReport.Report");
controller.startOperation();
`);

    expect(result.errors[0]?.message).toContain("no report called 'NoSuchReport'");
    expect(result.errors[0]?.hint).toContain("AOT element, not a class");
  });

  it("says which provider class the report expected when it is missing", async () => {
    const result = await run(RUN_IT);

    expect(result.errors[0]?.message).toContain("ItemSalesDP");
    expect(result.errors[0]?.hint).toContain("extends SRSReportDataProviderBase");
  });

  it("warns when nothing carries the dataset attribute", async () => {
    // The table is filled and the report still cannot bind to it. Silence here would be
    // the worst outcome: a report that runs, does work, and shows nothing.
    const result = await run(
      `
class ItemSalesDP extends SRSReportDataProviderBase
{
    public void processReport()
    {
    }
}
` + RUN_IT,
    );

    expect(result.infolog.some((entry) => entry.type === "warning")).toBe(true);
    expect(result.infolog.map((entry) => entry.message).join("\n")).toContain(
      "SRSReportDataSetAttribute",
    );
  });
});

describe("the base class is a real class", () => {
  it("gives the provider parmQuery and parmDataContract by inheritance", async () => {
    const logged = await messages(`
class ItemSalesDP extends SRSReportDataProviderBase
{
    public void processReport()
    {
        info("processReport ran");
    }
}

ItemSalesDP provider = new ItemSalesDP();
info(strFmt("Inherited parmQuery is callable: %1", provider.parmQuery() == null));
`);

    expect(logged).toContain("Inherited parmQuery is callable: Yes");
  });
});
