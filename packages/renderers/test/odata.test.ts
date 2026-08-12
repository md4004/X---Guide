/**
 * The OData endpoint, asserted against VB-055 to VB-059.
 *
 * The tests worth reading are the ones about what the endpoint *refuses*: an entity whose
 * public API switch is off, a `has` operator the specification has and F&O does not, and
 * a write. Each is a real afternoon lost, and each is a one-line message here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENTITIES } from "@xpplab/virtual-aot";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { handleODataRequest, listPublicCollections, type ODataRequest } from "@xpplab/renderers";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const get = (entity: string, query: ODataRequest["query"] = {}) =>
  handleODataRequest({ method: "GET", entity, query }, { entities: ENTITIES, db });

const rows = (body: unknown): Record<string, unknown>[] =>
  (body as { value: Record<string, unknown>[] }).value;

describe("the service root", () => {
  // VB-055
  it("lists only the entities whose public API switch is on", () => {
    expect(listPublicCollections(ENTITIES)).toEqual(["CustomersV3", "ReleasedProductsV2"]);
  });
});

describe("reading a collection", () => {
  it("returns the entity's properties, not the table's columns", async () => {
    const response = await get("ReleasedProductsV2", { top: 1 });

    expect(response.status).toBe(200);
    // `ItemNumber`, not `ItemId` — the whole point of an entity is that the physical
    // column name is not the contract.
    expect(Object.keys(rows(response.body)[0]!)).toContain("ItemNumber");
    expect(Object.keys(rows(response.body)[0]!)).not.toContain("ItemId");
  });

  // VB-052
  it("de-normalises a field from a joined table", async () => {
    const response = await get("CustomersV3", {
      select: ["CustomerAccount", "OrganizationName"],
      filter: "CustomerAccount eq 'C-1000'",
    });

    // The name lives on DirPartyTable, and the entity presents it as if it were the
    // customer's own. That is what a data entity is for.
    expect(rows(response.body)[0]).toEqual({
      CustomerAccount: "C-1000",
      OrganizationName: "Bramley & Fitch Retail",
    });
    expect(response.sql[0]?.statement).toContain("LEFT JOIN DirPartyTable");
  });

  it("shows the SQL it generated, with the filter value bound rather than inlined", async () => {
    const response = await get("ReleasedProductsV2", {
      filter: "ItemModelGroupId eq 'FURNITURE'",
    });

    expect(response.sql[0]?.statement).toContain("WHERE");
    expect(response.sql[0]?.statement).not.toContain("FURNITURE");
    expect(response.sql[0]?.parameters).toContain("FURNITURE");
    expect(rows(response.body)).toHaveLength(4);
  });

  it("honours $select, $top, $skip and $orderby", async () => {
    const response = await get("ReleasedProductsV2", {
      select: ["ItemNumber"],
      orderby: ["ItemNumber desc"],
      top: 2,
      skip: 1,
    });

    expect(rows(response.body)).toEqual([{ ItemNumber: "R-201" }, { ItemNumber: "R-200" }]);
  });

  it("adds a count when $count is asked for", async () => {
    const response = await get("ReleasedProductsV2", { count: true });
    expect((response.body as Record<string, unknown>)["@odata.count"]).toBe(8);
  });
});

describe("$filter", () => {
  it("combines predicates with and / or, and groups with parentheses", async () => {
    const response = await get("ReleasedProductsV2", {
      select: ["ItemNumber"],
      filter: "ItemModelGroupId eq 'RAWMAT' or ItemModelGroupId eq 'COMPONENT'",
      // Asked for explicitly: without $orderby the server is free to return any order,
      // and an integration that assumes one is a bug waiting for a different row count.
      orderby: ["ItemNumber"],
    });

    expect(rows(response.body).map((row) => row["ItemNumber"])).toEqual([
      "C-300",
      "R-200",
      "R-201",
    ]);
  });

  it("compares with the relational operators", async () => {
    const response = await get("ReleasedProductsV2", {
      select: ["ItemNumber"],
      filter: "StandardCost gt 200",
    });

    expect(rows(response.body)).toHaveLength(2);
  });

  // VB-057 — the documented wildcard form of contains.
  it("treats a starred literal as a contains", async () => {
    const response = await get("CustomersV3", {
      select: ["CustomerAccount"],
      filter: "CustomerGroupId eq '*RETAIL*'",
    });

    expect(rows(response.body).length).toBeGreaterThan(0);
    expect(response.sql[0]?.statement).toContain("LIKE");
  });

  // VB-057 — this is the one that costs people time.
  it("refuses `has` and `in` by name", async () => {
    const response = await get("ReleasedProductsV2", { filter: "ItemModelGroupId in ('A','B')" });

    expect(response.status).toBe(400);
    expect(response.error?.message).toContain("not supported");
    expect(response.error?.message).toContain("rewrite the filter");
  });

  it("names a property that does not exist, and lists the ones that do", async () => {
    const response = await get("ReleasedProductsV2", { filter: "ItemId eq 'F-100'" });

    // `ItemId` is the *table* column. The entity calls it ItemNumber, and the error says so.
    expect(response.status).toBe(400);
    expect(response.error?.message).toContain("is not a property");
    expect(response.error?.message).toContain("ItemNumber");
  });
});

describe("cross-company", () => {
  // VB-058 — the same trap as `crosscompany` in X++, one layer out.
  it("returns only the default company unless the request says otherwise", async () => {
    const scoped = await get("CustomersV3", { select: ["CustomerAccount"] });
    expect(rows(scoped.body)).toHaveLength(4);
    expect(scoped.sql[0]?.statement).toContain("DATAAREAID = ?");

    const all = await get("CustomersV3", { select: ["CustomerAccount"], crossCompany: true });
    expect(rows(all.body)).toHaveLength(10);
    expect(all.sql[0]?.statement).not.toContain("DATAAREAID = ?");
  });

  it("filters to one other company through dataAreaId", async () => {
    const response = await get("CustomersV3", {
      select: ["CustomerAccount"],
      filter: "dataAreaId eq 'KELT'",
      crossCompany: true,
    });

    expect(rows(response.body)).toHaveLength(3);
  });
});

describe("what it refuses", () => {
  // VB-055 — the entity exists; the switch is off. Saying which is the whole value.
  it("explains that an entity is not public rather than saying it does not exist", async () => {
    const response = await get("SalesOrderHeadersV2");

    expect(response.status).toBe(404);
    expect(response.error?.message).toContain("Enable public API");
    expect(response.error?.message).toContain("Data management can still see it");
  });

  it("404s an entity nobody has heard of", async () => {
    const response = await get("NoSuchThings");
    expect(response.status).toBe(404);
    expect(response.error?.message).toContain("no entity collection");
  });

  // VB-059 with VB-013: a write runs six steps, and this engine has two of them.
  it("refuses a write rather than running half of the validation chain", async () => {
    const response = await handleODataRequest(
      { method: "POST", entity: "ReleasedProductsV2", body: { ItemNumber: "X-1" } },
      { entities: ENTITIES, db },
    );

    expect(response.status).toBe(501);
    expect(response.error?.message).toContain("validateWrite");
    expect(response.error?.message).toContain("insert()");
  });
});
