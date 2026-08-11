import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualAot } from "@xpplab/virtual-aot";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { buildFormView, buildReportView, handleODataRequest } from "@xpplab/renderers";
import type { ReportDataSet } from "@xpplab/renderers";

describe("buildFormView", () => {
  let db: VirtualDb;
  const aot = createVirtualAot();

  beforeEach(async () => {
    db = createVirtualDb();
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  const listPage = () => aot.getForm("InventTableListPage")!;
  const details = () => aot.getForm("CustTableDetails")!;

  it("renders a grid over the form's data source", async () => {
    const view = await buildFormView({ form: listPage(), aot, db });

    expect(view.caption).toBe("Released products");
    expect(view.table).toBe("InventTable");
    // The eight seeded items in the default company, and only that company: a form runs
    // in one legal entity, so the grid must not show all three.
    expect(view.rowCount).toBe(8);
    expect(view.grid?.rows).toHaveLength(8);
  });

  it("shows an enum by its label, never by its stored number", async () => {
    const view = await buildFormView({ form: listPage(), aot, db });

    const blockedColumn = view.grid!.columns.findIndex((column) => column.name === "Blocked");
    const cells = view.grid!.rows.map((row) => row.cells[blockedColumn]);

    expect(new Set(cells)).toEqual(new Set(["No", "Yes"]));
    // F-102 is the one seeded as blocked.
    expect(cells.filter((cell) => cell === "Yes")).toHaveLength(1);
  });

  it("picks the control from the field's declared type, not from its name", async () => {
    const view = await buildFormView({ form: listPage(), aot, db });
    const byName = new Map(view.grid!.columns.map((column) => [column.name, column.control]));

    expect(byName.get("ItemId")).toBe("string");
    expect(byName.get("StandardCost")).toBe("real");
    expect(byName.get("Blocked")).toBe("checkbox");
    expect(byName.get("ItemType")).toBe("combo");
  });

  it("marks a read-only field as not editable even on an editable data source", async () => {
    const view = await buildFormView({ form: listPage(), aot, db });
    const itemId = view.grid!.columns.find((column) => column.name === "ItemId");

    expect(itemId?.editable).toBe(false);
    expect(itemId?.mandatory).toBe(true);
  });

  it("builds fast tabs for a details form, with a collapsed summary", async () => {
    const view = await buildFormView({ form: details(), aot, db });

    expect(view.fastTabs.map((tab) => tab.label)).toEqual(["Identification", "Credit and payment"]);

    const identification = view.fastTabs[0]!;
    expect(identification.fields.map((field) => field.name)).toEqual(["AccountNum", "CustGroup"]);
    expect(identification.summary).toHaveLength(2);
    expect(identification.fields[0]?.display).toBe("C-1000");
  });

  it("offers the enum's values as combo options", async () => {
    const view = await buildFormView({ form: details(), aot, db });
    const blocked = view.fastTabs
      .flatMap((tab) => tab.fields)
      .find((field) => field.name === "Blocked");

    expect(blocked?.options).toEqual([
      { label: "No", value: 0 },
      { label: "Invoice", value: 1 },
      { label: "All", value: 2 },
    ]);
  });

  it("shows the record asked for, not just the first", async () => {
    const rows = await db.readRows("CustTable");
    const second = Number(rows[1]!["RECID"]);

    const view = await buildFormView({ form: details(), aot, db, activeRecId: second });
    expect(view.fastTabs[0]?.fields[0]?.display).toBe("C-1001");
  });

  it("falls back to the first row when the requested one is not in the set", async () => {
    const view = await buildFormView({ form: details(), aot, db, activeRecId: 999_999 });
    expect(view.fastTabs[0]?.fields[0]?.display).toBe("C-1000");
  });
});

describe("buildReportView", () => {
  const data: ReportDataSet = {
    columns: [
      { name: "ItemGroupId", label: "Item group", type: "str" },
      { name: "ItemId", label: "Item number", type: "str" },
      { name: "LineAmount", label: "Net amount", type: "real" },
    ],
    rows: [
      { ItemGroupId: "FURNITURE", ItemId: "F-100", LineAmount: 100 },
      { ItemGroupId: "FURNITURE", ItemId: "F-101", LineAmount: 250 },
      { ItemGroupId: "RAWMAT", ItemId: "R-200", LineAmount: 40 },
    ],
  };

  const design = {
    title: "Sales by item group",
    groupBy: ["ItemGroupId"],
    totals: [{ column: "LineAmount", aggregate: "sum" as const }],
    pageSize: 40,
  };

  it("groups rows and totals each group", () => {
    const view = buildReportView(data, design);

    expect(view.groups.map((entry) => entry.label)).toEqual(["FURNITURE", "RAWMAT"]);
    expect(view.groups[0]?.totals["LineAmount"]).toBe(350);
    expect(view.groups[1]?.totals["LineAmount"]).toBe(40);
  });

  it("keeps the data provider's row order rather than sorting", () => {
    // The order is the RDP's decision — an `order by` it wrote. Re-sorting here would
    // quietly discard it.
    const reversed = { ...data, rows: [...data.rows].reverse() };
    expect(buildReportView(reversed, design).groups.map((entry) => entry.label)).toEqual([
      "RAWMAT",
      "FURNITURE",
    ]);
  });

  it("totals the whole report as well as each group", () => {
    expect(buildReportView(data, design).grandTotals["LineAmount"]).toBe(390);
  });

  it("hangs rows off the innermost group only, so nothing prints twice", () => {
    const view = buildReportView(data, { ...design, groupBy: ["ItemGroupId", "ItemId"] });

    expect(view.groups[0]?.rows).toEqual([]);
    expect(view.groups[0]?.children.map((child) => child.label)).toEqual(["F-100", "F-101"]);
    expect(view.groups[0]?.children[0]?.rows).toHaveLength(1);
  });

  it("returns flat rows when the design groups on nothing", () => {
    const view = buildReportView(data, { ...design, groupBy: [] });
    expect(view.groups).toEqual([]);
    expect(view.rows).toHaveLength(3);
  });

  it("counts and averages as well as sums", () => {
    const counted = buildReportView(data, {
      ...design,
      totals: [{ column: "LineAmount", aggregate: "count" }],
    });
    expect(counted.grandTotals["LineAmount"]).toBe(3);

    const averaged = buildReportView(data, {
      ...design,
      totals: [{ column: "LineAmount", aggregate: "avg" }],
    });
    expect(averaged.groups[0]?.totals["LineAmount"]).toBe(175);
  });

  it("averages an empty set to zero rather than NaN", () => {
    const view = buildReportView(
      { ...data, rows: [] },
      { ...design, totals: [{ column: "LineAmount", aggregate: "avg" }] },
    );
    expect(view.grandTotals["LineAmount"]).toBe(0);
  });

  it("refuses a design that references a column the provider did not return", () => {
    // Dropping it silently produces a report that looks fine and groups on nothing.
    expect(() => buildReportView(data, { ...design, groupBy: ["NoSuchColumn"] })).toThrowError(
      /NoSuchColumn/,
    );
  });

  it("reports at least one page even with no rows", () => {
    expect(buildReportView({ ...data, rows: [] }, design).pageCount).toBe(1);
  });
});

describe("what is still refused", () => {
  it("refuses an OData request rather than answering it wrongly", () => {
    expect(() =>
      handleODataRequest(
        { method: "GET", entity: "Customers" },
        { entities: [], db: {} as VirtualDb },
      ),
    ).toThrowError(/integration track/);
  });
});
