/**
 * The authored baseline AOT model.
 *
 * Tables, EDTs and enums are **derived from the database schema** rather than written out
 * again here. That is the whole point: in a real environment the metadata *is* the
 * definition of the table, so a model that could disagree with the database would be a
 * simulator that lies about the thing it exists to teach. Deriving makes disagreement
 * impossible.
 *
 * Forms are authored, because there is nothing to derive them from — a form is a design
 * decision, not a consequence of a schema. They are ours, hand-written, and deliberately
 * small. See CLAUDE.md > Legal rule: no extracted Microsoft metadata.
 */

import {
  BASE_ENUMS,
  SCHEMA,
  type FieldSchema,
  type TableSchema,
} from "@xpplab/virtual-db/metadata";
import type {
  AotModel,
  BaseEnumMetadata,
  DataEntityMetadata,
  EdtMetadata,
  FieldGroupMetadata,
  FieldMetadata,
  FormMetadata,
  TableMetadata,
} from "./types";

/**
 * The EDTs the schema refers to.
 *
 * Authored here because an EDT carries properties a field cannot — a string size and a
 * label shared by every field that uses it, which is the reason EDTs exist. The set is
 * exactly the `edt` values named in the schema; `edtsAreComplete` in the tests asserts
 * that, so adding an `edt:` to a field without adding it here fails the build.
 */
export const EDTS: readonly EdtMetadata[] = [
  {
    name: "CustAccount",
    baseType: "str",
    stringSize: 20,
    label: "Customer account",
    helpText: "The unique identifier of a customer.",
  },
  {
    name: "VendAccount",
    baseType: "str",
    stringSize: 20,
    label: "Vendor account",
    helpText: "The unique identifier of a vendor.",
  },
  {
    name: "ItemId",
    baseType: "str",
    stringSize: 20,
    label: "Item number",
    helpText: "The unique identifier of a released product.",
  },
];

/**
 * Field-level properties that metadata carries and the database does not.
 *
 * SQLite has no concept of "mandatory" or "read-only" — those are AOT properties, and in
 * F&O they are what the form engine enforces. Keyed `Table.Field`, compared case-
 * insensitively.
 */
const FIELD_PROPERTIES: Record<string, { mandatory?: boolean; allowEdit?: boolean }> = {
  "InventTable.ItemId": { mandatory: true, allowEdit: false },
  "InventTable.ItemName": { mandatory: true },
  "CustTable.AccountNum": { mandatory: true, allowEdit: false },
  "CustTable.CurrencyCode": { mandatory: true },
  "SalesTable.SalesId": { mandatory: true, allowEdit: false },
  "SalesTable.CustAccount": { mandatory: true },
  "SalesLine.SalesId": { mandatory: true, allowEdit: false },
  "SalesLine.ItemId": { mandatory: true },
};

/** Field groups, which forms lay out as a unit. Authored, like forms. */
const FIELD_GROUPS: Record<string, FieldGroupMetadata[]> = {
  InventTable: [
    { name: "Identification", label: "Identification", fields: ["ItemId", "ItemName"] },
    {
      name: "Classification",
      label: "Classification",
      fields: ["ItemGroupId", "ItemType", "Blocked"],
    },
    { name: "Costing", label: "Costing", fields: ["StandardCost"] },
  ],
  CustTable: [
    { name: "Identification", label: "Identification", fields: ["AccountNum", "CustGroup"] },
    {
      name: "Credit",
      label: "Credit and payment",
      fields: ["CurrencyCode", "PaymTermId", "CreditMax", "Blocked"],
    },
  ],
  SalesTable: [
    { name: "Identification", label: "Identification", fields: ["SalesId", "SalesName"] },
    {
      name: "Delivery",
      label: "Delivery",
      fields: ["CustAccount", "SalesStatus", "DeliveryDate", "CurrencyCode"],
    },
  ],
};

function toFieldMetadata(table: TableSchema, field: FieldSchema): FieldMetadata {
  const properties = FIELD_PROPERTIES[`${table.name}.${field.name}`] ?? {};

  return {
    name: field.name,
    label: field.label ?? field.name,
    baseType: field.type,
    ...(field.edt === undefined ? {} : { edt: field.edt }),
    ...(field.enumName === undefined ? {} : { enumName: field.enumName }),
    // A field is editable and optional unless the metadata says otherwise, which is the
    // AOT default too.
    mandatory: properties.mandatory ?? field.mandatory ?? false,
    allowEdit: properties.allowEdit ?? true,
  };
}

function toTableMetadata(table: TableSchema): TableMetadata {
  return {
    name: table.name,
    label: table.label,
    fields: table.fields.map((field) => toFieldMetadata(table, field)),
    fieldGroups: FIELD_GROUPS[table.name] ?? [],
    // Derived, like the fields: the database's indexes and relations *are* the table's,
    // and two lists that could disagree would be a simulator lying about the one thing
    // the designer exists to show.
    indexes: table.indexes.map((index) => ({
      name: index.name,
      fields: [...index.fields],
      allowDuplicates: !index.unique,
      primary: index.primary === true,
    })),
    relations: table.relations.map((relation) => ({
      name: relation.name,
      relatedTable: relation.relatedTable,
      fields: relation.fields.map(([field, relatedField]) => ({ field, relatedField })),
    })),
    methods: [],
    saveDataPerCompany: table.saveDataPerCompany,
  };
}

const TABLES: readonly TableMetadata[] = SCHEMA.map(toTableMetadata);

const ENUMS: readonly BaseEnumMetadata[] = BASE_ENUMS.map((baseEnum) => ({
  name: baseEnum.name,
  values: baseEnum.values.map((value) => ({ ...value })),
}));

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Two forms, in the two patterns a learner meets first.
 *
 * `InventTableListPage` is a grid over one table. `CustTableDetails` is the details
 * pattern: fast tabs of grouped fields over a single record. Both are ours.
 */
export const FORMS: readonly FormMetadata[] = [
  {
    name: "InventTableListPage",
    caption: "Released products",
    pattern: "SimpleList",
    dataSources: [{ name: "InventTable", table: "InventTable", allowEdit: true, children: [] }],
    design: {
      name: "Design",
      type: "group",
      children: [
        {
          name: "MainGrid",
          type: "grid",
          dataSource: "InventTable",
          children: [
            "ItemId",
            "ItemName",
            "ItemGroupId",
            "ItemType",
            "Blocked",
            "StandardCost",
          ].map((field) => ({
            name: `Grid_${field}`,
            type: "gridColumn" as const,
            dataSource: "InventTable",
            dataField: field,
            children: [],
          })),
        },
      ],
    },
  },

  {
    name: "CustTableDetails",
    caption: "Customers",
    pattern: "Details",
    dataSources: [{ name: "CustTable", table: "CustTable", allowEdit: true, children: [] }],
    design: {
      name: "Design",
      type: "tab",
      children: [
        {
          name: "Identification",
          type: "tabPage",
          label: "Identification",
          children: ["AccountNum", "CustGroup"].map((field) => ({
            name: `Fld_${field}`,
            type: "stringEdit" as const,
            dataSource: "CustTable",
            dataField: field,
            children: [],
          })),
        },
        {
          name: "Credit",
          type: "tabPage",
          label: "Credit and payment",
          children: ["CurrencyCode", "PaymTermId", "CreditMax", "Blocked"].map((field) => ({
            name: `Fld_${field}`,
            type: "stringEdit" as const,
            dataSource: "CustTable",
            dataField: field,
            children: [],
          })),
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Data entities
// ---------------------------------------------------------------------------

/**
 * Three entities, in three of the five categories, and all ours.
 *
 * The names follow the real public collection names because those are API surface and
 * fine to reference — but the field sets are hand-authored and deliberately small. See
 * CLAUDE.md > Legal rule.
 *
 * `CustomersV3` is the one that earns its place. It de-normalises `DirPartyTable.Name`
 * onto the customer, which is Microsoft's own worked example of what an entity is *for*
 * (VB-052) — and it means a learner can see one OData GET produce a join.
 *
 * `SalesOrderHeadersV2` is deliberately **not** public: it is the entity a learner tries
 * first and cannot find on the endpoint, which is the fastest way to learn that
 * `IsPublic` is a switch somebody has to throw (VB-055).
 */
export const ENTITIES: readonly DataEntityMetadata[] = [
  {
    name: "CustomerV3Entity",
    publicCollectionName: "CustomersV3",
    category: "Master",
    primaryTable: "CustTable",
    joins: [{ table: "DirPartyTable", fromField: "Party", toField: "RECID" }],
    primaryKeyFields: ["CustomerAccount"],
    mappings: {
      CustomerAccount: "CustTable.AccountNum",
      OrganizationName: "DirPartyTable.Name",
      CustomerGroupId: "CustTable.CustGroup",
      SalesCurrencyCode: "CustTable.CurrencyCode",
      PaymentTerms: "CustTable.PaymTermId",
      CreditLimit: "CustTable.CreditMax",
      IsBlocked: "CustTable.Blocked",
    },
    isPublic: true,
    dataManagementEnabled: true,
  },
  {
    name: "ReleasedProductV2Entity",
    publicCollectionName: "ReleasedProductsV2",
    category: "Master",
    primaryTable: "InventTable",
    joins: [],
    primaryKeyFields: ["ItemNumber"],
    mappings: {
      ItemNumber: "InventTable.ItemId",
      ProductName: "InventTable.ItemName",
      ItemModelGroupId: "InventTable.ItemGroupId",
      ProductType: "InventTable.ItemType",
      IsStopped: "InventTable.Blocked",
      StandardCost: "InventTable.StandardCost",
    },
    isPublic: true,
    dataManagementEnabled: true,
  },
  {
    name: "SalesOrderHeaderV2Entity",
    publicCollectionName: "SalesOrderHeadersV2",
    category: "Document",
    primaryTable: "SalesTable",
    joins: [],
    primaryKeyFields: ["SalesOrderNumber"],
    mappings: {
      SalesOrderNumber: "SalesTable.SalesId",
      SalesOrderName: "SalesTable.SalesName",
      OrderingCustomerAccountNumber: "SalesTable.CustAccount",
      SalesOrderStatus: "SalesTable.SalesStatus",
      RequestedShippingDate: "SalesTable.DeliveryDate",
      CurrencyCode: "SalesTable.CurrencyCode",
    },
    // Data management can see it; OData cannot. The two switches are independent.
    isPublic: false,
    dataManagementEnabled: true,
  },
];

export const BASE_MODEL: AotModel = {
  tables: TABLES.map((table) => ({ ...table })),
  edts: EDTS.map((edt) => ({ ...edt })),
  enums: ENUMS.map((baseEnum) => ({ ...baseEnum })),
  forms: FORMS.map((form) => ({ ...form })),
  entities: ENTITIES.map((entity) => ({ ...entity })),
  stubClasses: [],
};
