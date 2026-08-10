/**
 * Base enums referenced by the schema.
 *
 * Enum *names* and value names mirror the real F&O public API surface. The numeric
 * values match the real ones where they are part of that surface and well known
 * (`NoYes::No == 0`, `NoYes::Yes == 1`); everything else is ours.
 *
 * These live here rather than in `virtual-aot` because the schema and the seed data need
 * them, and `virtual-aot` does not exist until Phase 7. When it lands it should import
 * from here rather than redeclare — one definition, or they drift.
 */

export interface EnumValue {
  name: string;
  value: number;
  label: string;
}

export interface BaseEnum {
  name: string;
  values: EnumValue[];
}

const defineEnum = (name: string, values: [string, number, string][]): BaseEnum => ({
  name,
  values: values.map(([valueName, value, label]) => ({ name: valueName, value, label })),
});

export const BASE_ENUMS: readonly BaseEnum[] = [
  defineEnum("NoYes", [
    ["No", 0, "No"],
    ["Yes", 1, "Yes"],
  ]),
  defineEnum("ItemType", [
    ["Item", 0, "Item"],
    ["Service", 1, "Service"],
    ["BOM", 2, "BOM"],
  ]),
  defineEnum("CustVendorBlocked", [
    ["No", 0, "No"],
    ["Invoice", 1, "Invoice"],
    ["All", 2, "All"],
  ]),
  defineEnum("SalesStatus", [
    ["None", 0, "None"],
    ["Backorder", 1, "Open order"],
    ["Delivered", 2, "Delivered"],
    ["Invoiced", 3, "Invoiced"],
    ["Canceled", 4, "Canceled"],
  ]),
  defineEnum("DirPartyType", [
    ["None", 0, "None"],
    ["Person", 1, "Person"],
    ["Organization", 2, "Organization"],
  ]),
  defineEnum("LedgerJournalACType", [
    ["Ledger", 0, "Ledger"],
    ["Cust", 1, "Customer"],
    ["Vend", 2, "Vendor"],
    ["Bank", 3, "Bank"],
  ]),
  defineEnum("InventLocationType", [
    ["Standard", 0, "Standard"],
    ["Transit", 1, "Transit"],
    ["Quarantine", 2, "Quarantine"],
  ]),
  defineEnum("MainAccountType", [
    ["Profit", 0, "Profit and loss"],
    ["Revenue", 1, "Revenue"],
    ["Expense", 2, "Expense"],
    ["Asset", 3, "Asset"],
    ["Liability", 4, "Liability"],
    ["Equity", 5, "Balance"],
  ]),
] as const;

const ENUM_INDEX = new Map(BASE_ENUMS.map((baseEnum) => [baseEnum.name, baseEnum]));

export function getBaseEnum(name: string): BaseEnum | undefined {
  return ENUM_INDEX.get(name);
}

/**
 * Resolve `NoYes::Yes` to `1`. Seed data and tests use this instead of writing bare
 * integers, so a reader can tell what a column means without a lookup.
 *
 * Throws rather than returning undefined: a typo'd enum value in seed data is an
 * authoring bug, and it should stop the build rather than quietly seed a zero.
 */
export function enumValue(enumName: string, valueName: string): number {
  const found = ENUM_INDEX.get(enumName)?.values.find((value) => value.name === valueName);
  if (found === undefined) {
    throw new Error(`Unknown enum value ${enumName}::${valueName}`);
  }
  return found.value;
}
