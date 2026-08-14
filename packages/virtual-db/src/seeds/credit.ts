/**
 * The credit-exposure dataset, for the credit hold scenario.
 *
 * Every row is invented — see CLAUDE.md > Legal rule. It is a separate seed rather than an
 * addition to `default` for one reason: the default set is deliberately small-value, so
 * nobody in it is anywhere near their credit limit, and every existing lesson's row counts
 * and totals depend on it staying that way.
 *
 * The numbers are chosen so the scenario's rule has something to bite on, and so that a
 * solution which gets the rule *nearly* right still fails:
 *
 * | Company | Customer | Limit  | Balance | Open orders | Exposure | Over by | Verdict  |
 * | ------- | -------- | ------ | ------- | ----------- | -------- | ------- | -------- |
 * | HVND    | C-100    | 50,000 |  18,400 |       6,200 |   24,600 |       — | fine     |
 * | HVND    | C-200    | 20,000 |  19,500 |       2,100 |   21,600 |      8% | warning  |
 * | HVND    | C-300    | 30,000 |  28,000 |       9,200 |   37,200 |     24% | blocked  |
 * | HVND    | C-400    | 15,000 |  16,900 |           0 |   16,900 |  12.67% | blocked  |
 * | KELT    | C-100    | 200,000|  12,000 |           0 |   12,000 |       — | fine     |
 *
 * Three traps are deliberate:
 *
 *   - **C-200 is over the limit and must not be blocked.** A solution that stops at
 *     "exposure > limit" blocks it, and fails.
 *   - **C-400 is over on its balance alone**, so a solution that only counts open orders
 *     misses it; **C-300 is only over once open orders are counted**, so a solution that
 *     only counts the balance misses that one. Neither half passes on its own.
 *   - **C-100 exists in HVND and KELT with different limits**, and the KELT one is
 *     healthy. A `crosscompany` select blocks a customer in a company nobody asked about.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import { enumValue } from "../enums";
import { SHARED_DATAAREAID, type TableName } from "../schema";
import type { SeedDefinition } from "./types";

type Row = Record<string, SqlValue>;

const Blocked = (name: "No" | "Invoice" | "All") => enumValue("CustVendorBlocked", name);
const SalesStatus = (name: "Backorder" | "Delivered" | "Invoiced" | "Canceled") =>
  enumValue("SalesStatus", name);
const PartyType = (name: "Person" | "Organization") => enumValue("DirPartyType", name);
const ItemType = (name: "Item" | "Service" | "BOM") => enumValue("ItemType", name);

const inCompany = (company: string, rows: Row[]): Row[] =>
  rows.map((row) => ({ ...row, DATAAREAID: company }));

const parties: Row[] = [
  { RECID: 7001, PartyNumber: "P-7001", Name: "Ollerdale Joinery Ltd", CountryRegionId: "GBR" },
  { RECID: 7002, PartyNumber: "P-7002", Name: "Trenholm Interiors", CountryRegionId: "GBR" },
  { RECID: 7003, PartyNumber: "P-7003", Name: "Barrowfield Contracts", CountryRegionId: "GBR" },
  { RECID: 7004, PartyNumber: "P-7004", Name: "Sable & Crowe Fitouts", CountryRegionId: "GBR" },
  { RECID: 7005, PartyNumber: "P-7005", Name: "Ollerdale Joinery Norge", CountryRegionId: "NOR" },
].map((party) => ({
  ...party,
  PartyType: PartyType("Organization"),
  DATAAREAID: SHARED_DATAAREAID,
}));

const customers: Row[] = [
  ...inCompany("HVND", [
    {
      AccountNum: "C-100",
      Party: 7001,
      CustGroup: "TRADE",
      CurrencyCode: "GBP",
      PaymTermId: "N30",
      CreditMax: 50000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-200",
      Party: 7002,
      CustGroup: "RETAIL",
      CurrencyCode: "GBP",
      PaymTermId: "N30",
      CreditMax: 20000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-300",
      Party: 7003,
      CustGroup: "TRADE",
      CurrencyCode: "GBP",
      PaymTermId: "N60",
      CreditMax: 30000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-400",
      Party: 7004,
      CustGroup: "RETAIL",
      CurrencyCode: "GBP",
      PaymTermId: "N14",
      CreditMax: 15000,
      Blocked: Blocked("No"),
    },
  ]),
  // Same account number, different company, healthy. Blocking this one is the classic
  // crosscompany mistake, and the acceptance checks catch it.
  ...inCompany("KELT", [
    {
      AccountNum: "C-100",
      Party: 7005,
      CustGroup: "TRADE",
      CurrencyCode: "NOK",
      PaymTermId: "N30",
      CreditMax: 200000,
      Blocked: Blocked("No"),
    },
  ]),
];

/** Open invoices. The sums are the balances in the table above. */
const customerTransactions: Row[] = [
  ...inCompany("HVND", [
    inv("C-100", "INV-7001", "2026-05-04", 11200),
    inv("C-100", "INV-7002", "2026-06-01", 7200),
    inv("C-200", "INV-7010", "2026-04-18", 12000),
    inv("C-200", "INV-7011", "2026-05-30", 7500),
    inv("C-300", "INV-7020", "2026-03-11", 15500),
    inv("C-300", "INV-7021", "2026-05-22", 12500),
    inv("C-400", "INV-7030", "2026-02-27", 9400),
    inv("C-400", "INV-7031", "2026-06-09", 7500),
  ]),
  ...inCompany("KELT", [inv("C-100", "INV-7100", "2026-06-02", 12000)]),
];

function inv(account: string, voucher: string, date: string, amount: number): Row {
  return {
    AccountNum: account,
    Voucher: voucher,
    Invoice: voucher,
    TransDate: date,
    AmountMST: amount,
    AmountCur: amount,
    CurrencyCode: "GBP",
    Closed: "",
  };
}

/** One item, so the order lines have something to point at. */
const items: Row[] = inCompany("HVND", [
  {
    ItemId: "OAK-PANEL",
    ItemName: "Oak veneer panel",
    ItemGroupId: "RAWMAT",
    ItemType: ItemType("Item"),
    StandardCost: 180,
    Blocked: enumValue("NoYes", "No"),
  },
]);

/** Backorder = not yet delivered, so it still counts against the limit. */
const salesOrders: Row[] = inCompany("HVND", [
  {
    SalesId: "SO-7001",
    SalesName: "Ollerdale — replenishment",
    CustAccount: "C-100",
    SalesStatus: SalesStatus("Backorder"),
    DeliveryDate: "2026-09-04",
    CurrencyCode: "GBP",
  },
  {
    SalesId: "SO-7002",
    SalesName: "Trenholm — showroom",
    CustAccount: "C-200",
    SalesStatus: SalesStatus("Backorder"),
    DeliveryDate: "2026-09-08",
    CurrencyCode: "GBP",
  },
  {
    SalesId: "SO-7003",
    SalesName: "Barrowfield — phase two",
    CustAccount: "C-300",
    SalesStatus: SalesStatus("Backorder"),
    DeliveryDate: "2026-09-11",
    CurrencyCode: "GBP",
  },
  // Delivered, so it must NOT count. A solution that ignores the status inflates C-100's
  // exposure to 31,100 — still under the limit, so this trap costs nothing here, and it
  // is in the data so the SQL trace shows the learner a status filter earning its place.
  {
    SalesId: "SO-7004",
    SalesName: "Ollerdale — completed",
    CustAccount: "C-100",
    SalesStatus: SalesStatus("Delivered"),
    DeliveryDate: "2026-07-02",
    CurrencyCode: "GBP",
  },
]);

const salesLines: Row[] = inCompany("HVND", [
  line("SO-7001", 1, 4200),
  line("SO-7001", 2, 2000),
  line("SO-7002", 1, 2100),
  line("SO-7003", 1, 6000),
  line("SO-7003", 2, 3200),
  line("SO-7004", 1, 6500),
]);

function line(salesId: string, lineNum: number, amount: number): Row {
  return {
    SalesId: salesId,
    LineNum: lineNum,
    ItemId: "OAK-PANEL",
    SalesQty: 1,
    SalesPrice: amount,
    LineAmount: amount,
    InventLocationId: "MAIN",
  };
}

const rows: Partial<Record<TableName, readonly Row[]>> = {
  DirPartyTable: parties,
  CustTable: customers,
  CustTrans: customerTransactions,
  InventTable: items,
  SalesTable: salesOrders,
  SalesLine: salesLines,
};

export const creditSeed: SeedDefinition = {
  name: "credit",
  description:
    "Four fictional customers with real credit exposure — one comfortable, one marginally over, two over enough to stop — plus the same account number in a second company, healthy.",
  rows,
};
