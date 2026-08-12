/**
 * The Application Explorer tree, the element designers, and what a project is for.
 *
 * Asserted against VB-015 to VB-021. The point of these tests is not that a tree renders
 * — it is that the tree has the shape a learner will meet in the real product, and that
 * the read-only-ness of Application Explorer is enforced rather than described.
 */

import { describe, expect, it } from "vitest";
import {
  addField,
  addToProject,
  build,
  buildApplicationExplorer,
  buildDesigner,
  createProject,
  createVirtualAot,
  findNode,
  isInProject,
  markSynchronised,
  orderProperties,
  planSynchronisation,
  type DesignerNode,
  type FieldMetadata,
} from "../src";

const aot = () => createVirtualAot();

const labels = (node: DesignerNode | undefined): string[] =>
  (node?.children ?? []).map((child) => child.label);

describe("Application Explorer", () => {
  // VB-016
  it("groups the model store under the AOT's real top-level nodes", () => {
    const tree = buildApplicationExplorer(aot());

    expect(tree.label).toBe("AOT");
    expect(labels(tree)).toEqual([
      "Data Model",
      "Data Types",
      "Code",
      "User Interface",
      "Analytics",
    ]);
  });

  it("files each element type under the folder it actually lives in", () => {
    const tree = buildApplicationExplorer(aot());

    expect(labels(findNode(tree, "AOT/Data Model"))).toEqual(["Tables", "Views", "Data Entities"]);
    expect(labels(findNode(tree, "AOT/Data Types"))).toEqual(["Base Enums", "Extended Data Types"]);
    expect(labels(findNode(tree, "AOT/User Interface"))).toEqual(["Forms"]);
    expect(labels(findNode(tree, "AOT/Analytics"))).toEqual(["Reports"]);
  });

  it("files a view under Views rather than Tables", () => {
    // A view is not a table, and a tree that pretended otherwise would teach that reading
    // one and inserting into one are the same kind of thing.
    const tree = buildApplicationExplorer(aot());

    expect(labels(findNode(tree, "AOT/Data Model/Views"))).toEqual(["CustSalesOrderView"]);
    expect(labels(findNode(tree, "AOT/Data Model/Tables"))).not.toContain("CustSalesOrderView");
  });

  it("lists the data entities and the report", () => {
    const tree = buildApplicationExplorer(aot());

    expect(labels(findNode(tree, "AOT/Data Model/Data Entities"))).toContain("CustomerV3Entity");
    expect(labels(findNode(tree, "AOT/Analytics/Reports"))).toEqual(["ItemSalesReport"]);
  });

  it("lists the tables the model actually has", () => {
    const tree = buildApplicationExplorer(aot());
    const tables = labels(findNode(tree, "AOT/Data Model/Tables"));

    expect(tables).toContain("InventTable");
    expect(tables).toContain("CustTable");
  });

  it("filters on the search box without collapsing the tree's shape", () => {
    // The real pane keeps its structure while filtered, which is what makes it usable —
    // you can still see *where* the match lives.
    const tree = buildApplicationExplorer(aot(), "invent");

    expect(labels(tree)).toHaveLength(5);
    expect(labels(findNode(tree, "AOT/Data Model/Tables"))).toEqual([
      "InventTable",
      "InventSum",
      "InventLocation",
    ]);
    expect(labels(findNode(tree, "AOT/User Interface/Forms"))).toEqual(["InventTableListPage"]);
  });

  it("matches case-insensitively, as the pane does", () => {
    const tree = buildApplicationExplorer(aot(), "CUSTTABLE");
    expect(labels(findNode(tree, "AOT/Data Model/Tables"))).toEqual(["CustTable"]);
  });
});

describe("the table designer", () => {
  const designer = () => buildDesigner(aot(), { type: "table", name: "InventTable" })!;

  // VB-018
  it("opens with the nodes a table element is made of", () => {
    expect(labels(designer())).toEqual([
      "Fields",
      "Field Groups",
      "Indexes",
      "Relations",
      "Methods",
    ]);
  });

  it("lists every field the table has", () => {
    const fields = labels(findNode(designer(), "InventTable/Fields"));
    expect(fields).toContain("ItemId");
    expect(fields).toContain("StandardCost");
  });

  it("shows a field's EDT, and offers a jump to it", () => {
    // "Go to Base Enum FMFuelType" in the source; the same affordance for an EDT is how
    // anyone reads an unfamiliar table.
    const itemId = findNode(designer(), "InventTable/Fields/ItemId");
    const edt = itemId?.properties.find((property) => property.name === "Extended Data Type");

    expect(edt?.value).toBe("ItemId");
    expect(edt?.goTo).toEqual({ type: "edt", name: "ItemId" });
  });

  it("attributes the string size to the EDT it came from", () => {
    // This is the reason EDTs exist, and it is invisible unless the grid says where the
    // value came from.
    const itemId = findNode(designer(), "InventTable/Fields/ItemId");
    const size = itemId?.properties.find((property) => property.name === "String Size");

    expect(size?.value).toBe("20 (from ItemId)");
  });

  it("shows an enum field's type, and offers a jump to the enum", () => {
    const blocked = findNode(designer(), "InventTable/Fields/Blocked");
    const enumType = blocked?.properties.find((property) => property.name === "Enum Type");

    expect(enumType?.goTo).toEqual({ type: "baseEnum", name: "NoYes" });
  });

  it("marks a shared table's Save Data Per Company as a changed property", () => {
    // `Yes` is the AOT default, so the shared table is the one that stands out — which is
    // exactly the property the companies lesson turns on.
    const shared = buildDesigner(aot(), { type: "table", name: "DirPartyTable" })!;
    const property = shared.properties.find((entry) => entry.name === "Save Data Per Company");

    expect(property?.value).toBe("No");
    expect(property?.changed).toBe(true);
  });

  it("names a relation's target and spells out the field pairing", () => {
    // Read from a table that has one. `SalesTable.CustAccount` pointing at
    // `CustTable.AccountNum` is the join every lesson 5 exercise relies on, and the
    // designer is where a developer would go to find out that it exists.
    const sales = buildDesigner(aot(), { type: "table", name: "SalesTable" })!;
    const relation = findNode(sales, "SalesTable/Relations/CustTable");

    expect(
      relation?.properties.find((property) => property.name === "Related Table")?.goTo,
    ).toEqual({ type: "table", name: "CustTable" });
    expect(relation?.properties.find((property) => property.name === "Fields")?.value).toBe(
      "CustAccount = CustTable.AccountNum",
    );
  });
});

describe("the base enum designer", () => {
  it("shows each value's stored number, not just its label", () => {
    // A learner who has never seen this cannot read `Blocked == 1` in the SQL trace.
    const noYes = buildDesigner(aot(), { type: "baseEnum", name: "NoYes" })!;
    const yes = findNode(noYes, "NoYes/Yes");

    expect(yes?.properties.find((property) => property.name === "Enum Value")?.value).toBe("1");
    expect(yes?.properties.find((property) => property.name === "Label")?.value).toBe("Yes");
  });
});

describe("the form designer", () => {
  it("separates data sources from the control tree", () => {
    const form = buildDesigner(aot(), { type: "form", name: "InventTableListPage" })!;
    expect(labels(form)).toEqual(["Data Sources", "Design"]);
  });

  it("points a data source at its table", () => {
    const form = buildDesigner(aot(), { type: "form", name: "InventTableListPage" })!;
    const source = findNode(form, "InventTableListPage/Data Sources/InventTable");

    expect(source?.properties.find((property) => property.name === "Table")?.goTo).toEqual({
      type: "table",
      name: "InventTable",
    });
  });
});

describe("the Properties window orderings", () => {
  const properties = () => buildDesigner(aot(), { type: "table", name: "InventTable" })!.properties;

  // VB-018
  it("drops the headings entirely when ordering alphabetically", () => {
    const groups = orderProperties(properties(), "Alphabetical");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.properties.map((property) => property.name)).toEqual([
      "Label",
      "Name",
      "Primary Index",
      "Save Data Per Company",
    ]);
  });

  it("groups by category, in the pane's order", () => {
    const groups = orderProperties(properties(), "Categorized");
    expect(groups.map((group) => group.label)).toEqual(["General", "Appearance", "Data"]);
  });

  it("divides changed properties from defaulted ones", () => {
    const groups = orderProperties(properties(), "Changed");

    expect(groups.map((group) => group.label)).toEqual(["Changed", "Default"]);
    expect(groups[1]?.properties.map((property) => property.name)).toEqual([
      "Name",
      "Save Data Per Company",
    ]);
  });

  it("omits a category with nothing in it", () => {
    const groups = orderProperties(
      [{ name: "Name", value: "x", category: "General", changed: false }],
      "Categorized",
    );
    expect(groups.map((group) => group.label)).toEqual(["General"]);
  });
});

describe("a project is what makes an element editable", () => {
  const field = (name: string): FieldMetadata => ({
    name,
    label: name,
    baseType: "str",
    mandatory: false,
    allowEdit: true,
  });

  // VB-015 — the behaviour this whole module exists for.
  it("refuses to add a field to a table that is not in the project, and says why", () => {
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");

    const result = addField(project, model, "InventTable", field("Warranty"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("read-only");
    expect(result.hint).toContain("Add to project");
    expect(model.getField("InventTable", "Warranty")).toBeUndefined();
  });

  it("adds the field once the table is in the project", () => {
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");

    addToProject(project, { type: "table", name: "InventTable" });
    const result = addField(project, model, "InventTable", field("Warranty"));

    expect(result.ok).toBe(true);
    expect(model.getField("InventTable", "Warranty")?.label).toBe("Warranty");
  });

  it("shows the new field in the designer immediately", () => {
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    addToProject(project, { type: "table", name: "InventTable" });
    addField(project, model, "InventTable", field("Warranty"));

    const designer = buildDesigner(model, { type: "table", name: "InventTable" })!;
    expect(labels(findNode(designer, "InventTable/Fields"))).toContain("Warranty");
  });

  it("rejects a duplicate field name case-insensitively, as the compiler does", () => {
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    addToProject(project, { type: "table", name: "InventTable" });

    const result = addField(project, model, "InventTable", field("itemid"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already has a field");
  });

  it("refuses to add the same element to a project twice", () => {
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    addToProject(project, { type: "table", name: "InventTable" });

    expect(addToProject(project, { type: "table", name: "inventtable" }).ok).toBe(false);
    expect(project.elements).toHaveLength(1);
    expect(isInProject(project, { type: "table", name: "InventTable" })).toBe(true);
  });
});

describe("building and synchronising", () => {
  // VB-020
  it("reports the build's steps in the order a real build performs them", () => {
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    const result = build(project, aot());

    const steps = result.output.join("\n");
    expect(steps).toContain("Metadata validation");
    expect(steps).toContain("X++ code validation");
    expect(steps).toContain("Best practice checks");
    expect(steps).toContain("Database synchronization");
  });

  it("says plainly which steps it does not perform", () => {
    // A learner must not come away believing their X++ was compiled to IL in a browser.
    const result = build(createProject("P", "M"), aot());
    expect(result.output.join("\n")).toContain("Compilation and IL generation... (not simulated");
  });

  // VB-021
  it("skips synchronisation when the project property is false", () => {
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    project.properties.synchronizeDatabaseOnBuild = false;

    const result = build(project, aot());

    expect(result.synchronised).toBe(false);
    expect(result.output.join("\n")).toContain("Synchronize database on build is false");
  });

  it("plans an ALTER TABLE for a field added since the last synchronisation", () => {
    // The metadata changed the moment the field was added; the database did not. That gap
    // is the entire reason Synchronize database is its own command.
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    addToProject(project, { type: "table", name: "InventTable" });
    addField(project, model, "InventTable", {
      name: "Warranty",
      label: "Warranty",
      baseType: "int",
      mandatory: false,
      allowEdit: true,
    });

    expect(planSynchronisation(project).statements).toEqual([
      "ALTER TABLE InventTable ADD Warranty INTEGER",
    ]);

    markSynchronised(project);
    expect(planSynchronisation(project).statements).toEqual([]);
  });

  it("warns about a field with no label", () => {
    const model = aot();
    const project = createProject("XppLabTutorial", "XppLabTutorial");
    addToProject(project, { type: "table", name: "InventTable" });
    addField(project, model, "InventTable", {
      name: "Warranty",
      label: "   ",
      baseType: "str",
      mandatory: false,
      allowEdit: true,
    });

    const warnings = build(project, model).messages;
    expect(warnings.some((message) => message.element === "InventTable.Warranty")).toBe(true);
  });
});
