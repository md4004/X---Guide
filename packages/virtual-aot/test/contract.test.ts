import { describe, expect, it } from "vitest";
import { SCHEMA, BASE_ENUMS, getTableSchema } from "@xpplab/virtual-db";
import {
  BASE_MODEL,
  EDTS,
  createVirtualAot,
  validateField,
  validateWrite,
} from "@xpplab/virtual-aot";

describe("the model is derived from the database, not written twice", () => {
  it("has metadata for every table in the schema, and no others", () => {
    expect(BASE_MODEL.tables.map((table) => table.name).sort()).toEqual(
      SCHEMA.map((table) => table.name).sort(),
    );
  });

  it("has metadata for every field, in schema order", () => {
    for (const table of SCHEMA) {
      const metadata = BASE_MODEL.tables.find((entry) => entry.name === table.name);
      expect(
        metadata?.fields.map((field) => field.name),
        table.name,
      ).toEqual(table.fields.map((field) => field.name));
    }
  });

  it("carries every base enum with its values intact", () => {
    expect(BASE_MODEL.enums.map((item) => item.name).sort()).toEqual(
      BASE_ENUMS.map((item) => item.name).sort(),
    );

    const noYes = BASE_MODEL.enums.find((item) => item.name === "NoYes");
    expect(noYes?.values).toEqual([
      { name: "No", value: 0, label: "No" },
      { name: "Yes", value: 1, label: "Yes" },
    ]);
  });

  it("declares an EDT for every edt the schema names", () => {
    // Otherwise a field could extend a type the property grid cannot describe, and the
    // string-size check in validateField would silently never fire.
    const referenced = new Set(
      SCHEMA.flatMap((table) => table.fields.flatMap((field) => (field.edt ? [field.edt] : []))),
    );
    const declared = new Set(EDTS.map((edt) => edt.name));

    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("binds every form control to a field that actually exists", () => {
    // A control bound to a typo renders as a blank column. Catching it here means the
    // form renderer never has to decide what to do about it.
    const walk = (control: {
      dataSource?: string;
      dataField?: string;
      children: unknown[];
    }): void => {
      if (control.dataField !== undefined && control.dataSource !== undefined) {
        expect(
          getTableSchema(control.dataSource)?.fields.some(
            (field) => field.name === control.dataField,
          ),
          `${control.dataSource}.${control.dataField}`,
        ).toBe(true);
      }
      for (const child of control.children) {
        walk(child as Parameters<typeof walk>[0]);
      }
    };

    for (const form of BASE_MODEL.forms) walk(form.design);
  });
});

describe("lookups", () => {
  const aot = createVirtualAot();

  it("resolves tables, fields and forms case-insensitively, as X++ does", () => {
    expect(aot.getTable("custtable")?.name).toBe("CustTable");
    expect(aot.getField("INVENTTABLE", "itemid")?.name).toBe("ItemId");
    expect(aot.getForm("inventtablelistpage")?.caption).toBe("Released products");
    expect(aot.getEnum("noyes")?.values).toHaveLength(2);
  });

  it("returns undefined for what does not exist, rather than throwing", () => {
    expect(aot.getTable("NoSuchTable")).toBeUndefined();
    expect(aot.getField("CustTable", "NoSuchField")).toBeUndefined();
  });

  it("lists objects, optionally by type", () => {
    expect(aot.listObjects("form").map((ref) => ref.name)).toEqual([
      "InventTableListPage",
      "CustTableDetails",
    ]);
    expect(aot.listObjects().length).toBeGreaterThan(aot.listObjects("form").length);
  });

  it("hands out a model a caller cannot use to poison the baseline", () => {
    const fresh = createVirtualAot();
    fresh.getModel().tables.length = 0;
    fresh.reset();
    expect(fresh.getModel().tables.length).toBeGreaterThan(0);
  });
});

describe("what is refused rather than faked", () => {
  const aot = createVirtualAot();

  it("refuses to apply an extension, with a message naming where it arrives", () => {
    const result = aot.applyExtension({
      name: "MyExtension",
      target: { type: "table", name: "InventTable" },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain("not available yet");
  });

  it("refuses to resolve a Chain of Command rather than return an empty one", () => {
    // An empty chain reads as "nothing extends this", which is a different claim.
    expect(() => aot.resolveCoc({ type: "table", name: "InventTable" }, "insert")).toThrowError(
      /customisation track/,
    );
  });
});

describe("validateField", () => {
  const aot = createVirtualAot();
  const itemId = aot.getField("InventTable", "ItemId")!;
  const standardCost = aot.getField("InventTable", "StandardCost")!;

  it("fails a mandatory field left empty, with the label the form would show", () => {
    const result = validateField(itemId, "");
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.message).toBe("Field 'Item number' must be filled in.");
  });

  it("treats zero as empty, because X++ has no null", () => {
    // This is the same rule that makes `if (buffer.RecId)` the idiomatic existence check.
    expect(validateField(itemId, 0).ok).toBe(false);
  });

  it("passes an optional field left empty", () => {
    expect(validateField(standardCost, 0).ok).toBe(true);
  });

  it("fails a string longer than its EDT allows", () => {
    const result = validateField(itemId, "X".repeat(21), 20);
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.message).toContain("20 characters");
  });

  it("passes a string exactly at the limit", () => {
    expect(validateField(itemId, "X".repeat(20), 20).ok).toBe(true);
  });
});

describe("validateWrite", () => {
  const aot = createVirtualAot();
  const table = aot.getTable("InventTable")!;

  it("passes a record with every mandatory field filled", () => {
    const result = validateWrite({
      table,
      values: { ItemId: "F-500", ItemName: "Standing desk", ItemGroupId: "FURNITURE" },
    });
    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("reports every failing field, not just the first", () => {
    // "If a validation fails because of an error, validation for the remaining fields
    // continues" — and one message at a time is poor feedback anyway.
    const result = validateWrite({ table, values: {} });
    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.field)).toEqual(["ItemId", "ItemName"]);
  });

  it("matches field names case-insensitively", () => {
    const result = validateWrite({
      table,
      values: { itemid: "F-500", itemname: "Standing desk" },
    });
    expect(result.ok).toBe(true);
  });

  it("enforces the EDT string size when one is supplied", () => {
    const result = validateWrite({
      table,
      values: { ItemId: "X".repeat(30), ItemName: "Too long" },
      edtStringSizes: { ItemId: 20 },
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.field).toBe("ItemId");
  });
});
