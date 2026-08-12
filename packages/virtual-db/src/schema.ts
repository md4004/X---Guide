/**
 * Schema for the virtual AOS database.
 *
 * Table and field *names* mirror the real F&O public API surface, which is fine to
 * reference. Everything else — the column sets, the seed rows, the relations — is
 * hand-authored here and deliberately far smaller than the real thing. No extracted
 * Microsoft metadata, no Contoso data. See CLAUDE.md > Legal rule.
 *
 * Two columns are implicit on every table and are never listed in `fields`:
 *   RECID      int64, unique within the table across all companies
 *   DATAAREAID str 4, the legal entity — present even on shared tables, where it is
 *              stored as the empty string and never filtered on
 */

import type { CompanyId } from "@xpplab/xpp-core";

/** The starter table set for Phase 1. Widening this is a scope decision, not a detail. */
export const TABLE_NAMES = [
  "CustTable",
  "CustTrans",
  "VendTable",
  "InventTable",
  "InventSum",
  "SalesTable",
  "SalesLine",
  "MainAccount",
  "LedgerJournalTable",
  "LedgerJournalTrans",
  "WMSLocation",
  "InventLocation",
  "DirPartyTable",
  "TmpItemSales",
  // The financial dimension framework. Four tables, because that is genuinely how many it
  // takes to store "CostCenter = CC-100" against a customer — see docs/verified-behaviour
  // VB-027, and the dimensions lessons built on it.
  "DimensionAttribute",
  "DimensionAttributeValue",
  "DimensionAttributeValueSet",
  "DimensionAttributeValueSetItem",
] as const;

/**
 * Views.
 *
 * A view is a `select` saved as an element you can select *from*. It has no storage of
 * its own — SQLite creates a real `CREATE VIEW`, so reading one really does run the join
 * underneath, and the SQL trace shows it.
 *
 * Kept in their own list rather than mixed into `TABLE_NAMES` because the AOT files them
 * separately, and because nothing may ever seed or insert into one.
 */
export const VIEW_NAMES = ["CustSalesOrderView"] as const;

export type TableName = (typeof TABLE_NAMES)[number] | (typeof VIEW_NAMES)[number];

export type ViewName = (typeof VIEW_NAMES)[number];

export function isViewName(name: string): name is ViewName {
  return (VIEW_NAMES as readonly string[]).includes(name);
}

/** The system columns present on every table. */
export const RECID_FIELD = "RECID";
export const DATAAREAID_FIELD = "DATAAREAID";

/** Shared tables store this in `DATAAREAID`, and reads never filter on it. */
export const SHARED_DATAAREAID = "";

/**
 * The X++ base types a simulated field can have. Each maps to a SQLite storage class:
 * `str`/`date`/`utcdatetime`/`guid` to TEXT, `int`/`int64`/`enum` to INTEGER, `real` to
 * REAL, `container` to BLOB.
 */
export type FieldType =
  "str" | "int" | "int64" | "real" | "date" | "utcdatetime" | "enum" | "guid" | "container";

export interface FieldSchema {
  name: string;
  type: FieldType;
  /** For `str` fields. Informational until Phase 7 shows it in the property grid. */
  length?: number;
  /** For `enum` fields — the base enum name in `enums.ts`. */
  enumName?: string;
  /** The EDT this field extends, when it has one. Drives Phase 7 lessons. */
  edt?: string;
  mandatory?: boolean;
  /** Rendered label. Real F&O gets this from the label file; we author it inline. */
  label?: string;
}

export interface IndexSchema {
  name: string;
  fields: string[];
  unique: boolean;
  /** The index F&O would treat as the primary one. */
  primary?: boolean;
}

export interface RelationSchema {
  name: string;
  relatedTable: TableName;
  /** `[thisField, relatedField]` pairs. */
  fields: ReadonlyArray<readonly [string, string]>;
}

export interface TableSchema {
  name: TableName;
  label: string;
  fields: FieldSchema[];
  indexes: IndexSchema[];
  relations: RelationSchema[];
  /**
   * `true` for a table a report data provider fills and a report design reads.
   *
   * Real F&O temp tables (`InMemory` / `TempDB`) live for the duration of a process and
   * are never seeded. This one is an ordinary SQLite table that simply starts empty and
   * is cleared between runs — the *shape* of the RDP pattern is what the lesson teaches,
   * and the lifetime difference is stated in prose rather than simulated.
   */
  isTemp?: boolean;
  /**
   * `true` for a view. A view has no storage: `viewSql` is created as a real SQLite
   * `CREATE VIEW`, so selecting from one runs the join underneath and the trace shows it.
   * Nothing may seed or insert into a view.
   */
  isView?: boolean;
  /** The select behind a view. Required when `isView` is set, ignored otherwise. */
  viewSql?: string;
  /**
   * `false` for tables that are shared across companies rather than company-scoped.
   * `DirPartyTable` is the reason this flag exists — it is genuinely global in F&O, and
   * that contrast is the whole point of the companies lesson.
   */
  saveDataPerCompany: boolean;
}

export interface CompanyDefinition {
  id: CompanyId;
  name: string;
  currency: string;
}

/**
 * Three fictional legal entities. Invented for this repo — any resemblance to a real
 * Microsoft demo company is a bug, not a shortcut.
 *
 * `DATAAREAID` is `str 4` in F&O, so the ids are four characters.
 */
export const COMPANIES: readonly CompanyDefinition[] = [
  { id: "HVND", name: "Havensdale Instruments Ltd", currency: "GBP" },
  { id: "KELT", name: "Kelton Nordic AS", currency: "NOK" },
  { id: "MRDA", name: "Meridia Trading BV", currency: "EUR" },
];

export const DEFAULT_COMPANY: CompanyId = COMPANIES[0]!.id;

// ---------------------------------------------------------------------------
// Field helpers — keep the table definitions below readable
// ---------------------------------------------------------------------------

const str = (name: string, length: number, label: string, edt?: string): FieldSchema => ({
  name,
  type: "str",
  length,
  label,
  ...(edt === undefined ? {} : { edt }),
});

const int64 = (name: string, label: string): FieldSchema => ({ name, type: "int64", label });
const real = (name: string, label: string): FieldSchema => ({ name, type: "real", label });
const date = (name: string, label: string): FieldSchema => ({ name, type: "date", label });

const enumField = (name: string, enumName: string, label: string): FieldSchema => ({
  name,
  type: "enum",
  enumName,
  label,
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const SCHEMA: readonly TableSchema[] = [
  {
    name: "DirPartyTable",
    label: "Parties",
    saveDataPerCompany: false,
    fields: [
      str("PartyNumber", 20, "Party number"),
      str("Name", 100, "Name"),
      enumField("PartyType", "DirPartyType", "Party type"),
      str("CountryRegionId", 10, "Country/region"),
    ],
    indexes: [{ name: "PartyNumberIdx", fields: ["PartyNumber"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "CustTable",
    label: "Customers",
    saveDataPerCompany: true,
    fields: [
      str("AccountNum", 20, "Customer account", "CustAccount"),
      int64("Party", "Party"),
      str("CustGroup", 10, "Customer group"),
      str("CurrencyCode", 3, "Currency"),
      str("PaymTermId", 10, "Terms of payment"),
      real("CreditMax", "Credit limit"),
      enumField("Blocked", "CustVendorBlocked", "Blocked"),
      int64("DefaultDimension", "Financial dimensions"),
    ],
    indexes: [{ name: "AccountIdx", fields: ["AccountNum"], unique: true, primary: true }],
    relations: [
      { name: "DirPartyTable", relatedTable: "DirPartyTable", fields: [["Party", "RECID"]] },
    ],
  },

  {
    name: "CustTrans",
    label: "Customer transactions",
    saveDataPerCompany: true,
    fields: [
      str("AccountNum", 20, "Customer account", "CustAccount"),
      str("Voucher", 20, "Voucher"),
      date("TransDate", "Date"),
      str("Invoice", 20, "Invoice"),
      real("AmountMST", "Amount in accounting currency"),
      real("AmountCur", "Amount in transaction currency"),
      str("CurrencyCode", 3, "Currency"),
      date("Closed", "Closed"),
    ],
    indexes: [
      { name: "VoucherIdx", fields: ["Voucher", "TransDate"], unique: false, primary: true },
      { name: "AccountIdx", fields: ["AccountNum", "TransDate"], unique: false },
    ],
    relations: [
      { name: "CustTable", relatedTable: "CustTable", fields: [["AccountNum", "AccountNum"]] },
    ],
  },

  {
    name: "VendTable",
    label: "Vendors",
    saveDataPerCompany: true,
    fields: [
      str("AccountNum", 20, "Vendor account", "VendAccount"),
      int64("Party", "Party"),
      str("VendGroup", 10, "Vendor group"),
      str("CurrencyCode", 3, "Currency"),
      enumField("Blocked", "CustVendorBlocked", "Blocked"),
    ],
    indexes: [{ name: "AccountIdx", fields: ["AccountNum"], unique: true, primary: true }],
    relations: [
      { name: "DirPartyTable", relatedTable: "DirPartyTable", fields: [["Party", "RECID"]] },
    ],
  },

  {
    name: "InventTable",
    label: "Released products",
    saveDataPerCompany: true,
    fields: [
      str("ItemId", 20, "Item number", "ItemId"),
      str("ItemName", 60, "Product name"),
      str("ItemGroupId", 10, "Item group"),
      enumField("ItemType", "ItemType", "Item type"),
      enumField("Blocked", "NoYes", "Stopped"),
      real("StandardCost", "Standard cost"),
      int64("DefaultDimension", "Financial dimensions"),
    ],
    indexes: [{ name: "ItemIdx", fields: ["ItemId"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "InventSum",
    label: "On-hand inventory",
    saveDataPerCompany: true,
    fields: [
      str("ItemId", 20, "Item number", "ItemId"),
      str("InventLocationId", 20, "Warehouse"),
      real("PhysicalInvent", "Physical inventory"),
      real("AvailPhysical", "Physical available"),
      real("PostedQty", "Posted quantity"),
    ],
    indexes: [
      {
        name: "ItemLocationIdx",
        fields: ["ItemId", "InventLocationId"],
        unique: true,
        primary: true,
      },
    ],
    relations: [
      { name: "InventTable", relatedTable: "InventTable", fields: [["ItemId", "ItemId"]] },
      {
        name: "InventLocation",
        relatedTable: "InventLocation",
        fields: [["InventLocationId", "InventLocationId"]],
      },
    ],
  },

  {
    name: "SalesTable",
    label: "Sales orders",
    saveDataPerCompany: true,
    fields: [
      str("SalesId", 20, "Sales order"),
      str("SalesName", 60, "Name"),
      str("CustAccount", 20, "Customer account", "CustAccount"),
      enumField("SalesStatus", "SalesStatus", "Status"),
      date("DeliveryDate", "Delivery date"),
      str("CurrencyCode", 3, "Currency"),
      int64("DefaultDimension", "Financial dimensions"),
    ],
    indexes: [{ name: "SalesIdx", fields: ["SalesId"], unique: true, primary: true }],
    relations: [
      { name: "CustTable", relatedTable: "CustTable", fields: [["CustAccount", "AccountNum"]] },
    ],
  },

  {
    name: "SalesLine",
    label: "Sales order lines",
    saveDataPerCompany: true,
    fields: [
      str("SalesId", 20, "Sales order"),
      real("LineNum", "Line number"),
      str("ItemId", 20, "Item number", "ItemId"),
      real("SalesQty", "Quantity"),
      real("SalesPrice", "Unit price"),
      real("LineAmount", "Net amount"),
      str("InventLocationId", 20, "Warehouse"),
      int64("DefaultDimension", "Financial dimensions"),
    ],
    indexes: [
      { name: "SalesLineIdx", fields: ["SalesId", "LineNum"], unique: true, primary: true },
    ],
    relations: [
      { name: "SalesTable", relatedTable: "SalesTable", fields: [["SalesId", "SalesId"]] },
      { name: "InventTable", relatedTable: "InventTable", fields: [["ItemId", "ItemId"]] },
    ],
  },

  {
    name: "MainAccount",
    label: "Main accounts",
    saveDataPerCompany: true,
    fields: [
      str("MainAccountId", 20, "Main account"),
      str("Name", 60, "Name"),
      enumField("Type", "MainAccountType", "Main account type"),
      str("CurrencyCode", 3, "Currency"),
    ],
    indexes: [{ name: "MainAccountIdx", fields: ["MainAccountId"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "LedgerJournalTable",
    label: "Journal headers",
    saveDataPerCompany: true,
    fields: [
      str("JournalNum", 20, "Journal batch number"),
      str("JournalName", 10, "Name"),
      str("Name", 60, "Description"),
      enumField("Posted", "NoYes", "Posted"),
      date("PostedDateTime", "Posted date"),
    ],
    indexes: [{ name: "JournalNumIdx", fields: ["JournalNum"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "LedgerJournalTrans",
    label: "Journal lines",
    saveDataPerCompany: true,
    fields: [
      str("JournalNum", 20, "Journal batch number"),
      str("Voucher", 20, "Voucher"),
      date("TransDate", "Date"),
      enumField("AccountType", "LedgerJournalACType", "Account type"),
      str("LedgerDimension", 30, "Account"),
      str("Txt", 60, "Description"),
      real("AmountCurDebit", "Debit"),
      real("AmountCurCredit", "Credit"),
      str("CurrencyCode", 3, "Currency"),
    ],
    indexes: [
      {
        name: "JournalVoucherIdx",
        fields: ["JournalNum", "Voucher"],
        unique: false,
        primary: true,
      },
    ],
    relations: [
      {
        name: "LedgerJournalTable",
        relatedTable: "LedgerJournalTable",
        fields: [["JournalNum", "JournalNum"]],
      },
    ],
  },

  {
    name: "InventLocation",
    label: "Warehouses",
    saveDataPerCompany: true,
    fields: [
      str("InventLocationId", 20, "Warehouse"),
      str("Name", 60, "Name"),
      str("InventSiteId", 20, "Site"),
      enumField("InventLocationType", "InventLocationType", "Warehouse type"),
    ],
    indexes: [{ name: "LocationIdx", fields: ["InventLocationId"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "WMSLocation",
    label: "Warehouse locations",
    saveDataPerCompany: true,
    fields: [
      str("WMSLocationId", 20, "Location"),
      str("InventLocationId", 20, "Warehouse"),
      str("Aisle", 10, "Aisle"),
      str("Rack", 10, "Rack"),
      str("Shelf", 10, "Shelf"),
    ],
    indexes: [
      {
        name: "WMSLocationIdx",
        fields: ["InventLocationId", "WMSLocationId"],
        unique: true,
        primary: true,
      },
    ],
    relations: [
      {
        name: "InventLocation",
        relatedTable: "InventLocation",
        fields: [["InventLocationId", "InventLocationId"]],
      },
    ],
  },

  {
    name: "TmpItemSales",
    label: "Item sales (report data)",
    saveDataPerCompany: true,
    isTemp: true,
    fields: [
      str("ItemGroupId", 10, "Item group"),
      str("ItemId", 20, "Item number", "ItemId"),
      str("ItemName", 60, "Product name"),
      real("SalesQty", "Quantity"),
      real("LineAmount", "Net amount"),
    ],
    // No unique index: a data provider may legitimately write the same item twice, once
    // per source line, and leave the grouping to the report design.
    indexes: [
      { name: "GroupItemIdx", fields: ["ItemGroupId", "ItemId"], unique: false, primary: true },
    ],
    relations: [
      { name: "InventTable", relatedTable: "InventTable", fields: [["ItemId", "ItemId"]] },
    ],
  },

  // -------------------------------------------------------------------------
  // The financial dimension framework
  //
  // Four tables to store what looks like two columns on a customer, and every one of them
  // is shared rather than company-scoped. That shape is the reason dimensions confuse
  // people, so it is modelled rather than flattened: a learner who has followed
  // DefaultDimension through to a display value once can debug dimension problems for the
  // rest of their career, and one who has only seen a flattened version cannot.
  //
  // Only the storage shape is simulated. Account structures, advanced rules and
  // posting-time validation are out — see docs/unverified.md.
  // -------------------------------------------------------------------------

  {
    name: "DimensionAttribute",
    label: "Financial dimensions",
    saveDataPerCompany: false,
    fields: [
      str("Name", 40, "Dimension name"),
      // VB-032: custom dimensions keep their values by hand; entity-backed ones take them
      // from another table.
      str("BackingEntityType", 20, "Values from"),
    ],
    indexes: [{ name: "NameIdx", fields: ["Name"], unique: true, primary: true }],
    relations: [],
  },

  {
    name: "DimensionAttributeValue",
    label: "Financial dimension values",
    saveDataPerCompany: false,
    fields: [
      int64("DimensionAttribute", "Dimension"),
      // VB-032: dimension values are at most 30 characters.
      str("DisplayValue", 30, "Dimension value"),
      str("Description", 60, "Description"),
    ],
    indexes: [
      {
        name: "AttributeValueIdx",
        fields: ["DimensionAttribute", "DisplayValue"],
        unique: true,
        primary: true,
      },
    ],
    relations: [
      {
        name: "DimensionAttribute",
        relatedTable: "DimensionAttribute",
        fields: [["DimensionAttribute", "RECID"]],
      },
    ],
  },

  {
    name: "DimensionAttributeValueSet",
    label: "Financial dimension sets",
    saveDataPerCompany: false,
    // Almost nothing but an identity, and that *is* the lesson: the set is a hook for
    // other tables to point at, and the values hang off it one row at a time.
    //
    // `Hash` is how the framework finds an existing set with the same values instead of
    // writing a duplicate — the behaviour VB-030's worked example shows when a merge
    // reuses the source's record. The column name is our reading; see docs/unverified.md.
    fields: [str("Hash", 120, "Hash")],
    indexes: [{ name: "HashIdx", fields: ["Hash"], unique: false, primary: true }],
    relations: [],
  },

  {
    name: "DimensionAttributeValueSetItem",
    label: "Financial dimension set values",
    saveDataPerCompany: false,
    fields: [
      int64("DimensionAttributeValueSet", "Dimension set"),
      int64("DimensionAttributeValue", "Dimension value"),
      // Denormalised onto the item, as the real table denormalises it. It is why the
      // documented queries can read a display value without a third join.
      str("DisplayValue", 30, "Dimension value"),
    ],
    indexes: [
      {
        name: "SetIdx",
        fields: ["DimensionAttributeValueSet", "DimensionAttributeValue"],
        unique: true,
        primary: true,
      },
    ],
    relations: [
      {
        name: "DimensionAttributeValueSet",
        relatedTable: "DimensionAttributeValueSet",
        fields: [["DimensionAttributeValueSet", "RECID"]],
      },
      {
        name: "DimensionAttributeValue",
        relatedTable: "DimensionAttributeValue",
        fields: [["DimensionAttributeValue", "RECID"]],
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Views
  //
  // Last, because a view can only be created once the tables it reads exist.
  //
  // `CustSalesOrderView` is the shape a view is actually for: a join somebody got tired of
  // writing. It carries `DATAAREAID` so company scoping still works when you select from
  // it — a view that dropped that column would silently return every company's orders,
  // which is the classic way a view becomes a security problem rather than a convenience.
  // -------------------------------------------------------------------------
  {
    name: "CustSalesOrderView",
    label: "Sales orders with customer",
    saveDataPerCompany: true,
    isView: true,
    viewSql: `SELECT
        SalesTable.SalesId AS SalesId,
        SalesTable.CustAccount AS CustAccount,
        CustTable.CustGroup AS CustGroup,
        SalesTable.SalesStatus AS SalesStatus,
        SalesTable.CurrencyCode AS CurrencyCode,
        SalesTable.RECID AS RECID,
        SalesTable.DATAAREAID AS DATAAREAID
      FROM SalesTable
      INNER JOIN CustTable
        ON CustTable.AccountNum = SalesTable.CustAccount
       AND CustTable.DATAAREAID = SalesTable.DATAAREAID`,
    fields: [
      str("SalesId", 20, "Sales order"),
      str("CustAccount", 20, "Customer account", "CustAccount"),
      str("CustGroup", 10, "Customer group"),
      enumField("SalesStatus", "SalesStatus", "Status"),
      str("CurrencyCode", 3, "Currency"),
    ],
    indexes: [],
    relations: [],
  },
];

/**
 * The two halves of `SCHEMA`, because most invariants are about one or the other.
 *
 * A table has storage, a primary index and system columns of its own; a view has none of
 * those and instead has to *select* the system columns, or company scoping stops working
 * the moment somebody reads it.
 */
export const TABLES: readonly TableSchema[] = SCHEMA.filter((entry) => entry.isView !== true);
export const VIEWS: readonly TableSchema[] = SCHEMA.filter((entry) => entry.isView === true);

const SCHEMA_INDEX = new Map<string, TableSchema>(SCHEMA.map((table) => [table.name, table]));

/**
 * Look up a table by name, case-insensitively — X++ identifiers are case-insensitive and
 * learners will type `custTable`.
 */
export function getTableSchema(name: string): TableSchema | undefined {
  return SCHEMA_INDEX.get(name) ?? SCHEMA.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

export function isTableName(name: string): name is TableName {
  return getTableSchema(name) !== undefined;
}

export function getCompany(id: string): CompanyDefinition | undefined {
  return COMPANIES.find((company) => company.id === id);
}
