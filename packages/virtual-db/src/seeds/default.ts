/**
 * The default dataset.
 *
 * Every row here is invented. There is no Contoso data, no export from a real
 * environment, and no Microsoft demo company — see CLAUDE.md > Legal rule. The three
 * legal entities are Havensdale Instruments (HVND), Kelton Nordic (KELT) and Meridia
 * Trading (MRDA).
 *
 * Shape choices that lessons depend on, so change them carefully:
 *   - `C-1000` exists in more than one company, with different data in each. That
 *     collision is the entire point of the companies lesson.
 *   - `InventTable.ItemGroupId` uses FURNITURE / RAWMAT / COMPONENT, which the worked
 *     example in docs/lesson-schema.md selects on.
 *   - Every company has at least one blocked customer and one stopped item, so
 *     `where` clauses have something to exclude.
 *   - `DirPartyTable` is shared, and its RECIDs are assigned explicitly here so the
 *     `Party` foreign keys are stable across reseeds.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import { enumValue } from "../enums";
import { SHARED_DATAAREAID, type TableName } from "../schema";
import type { SeedDefinition } from "./types";

type Row = Record<string, SqlValue>;

const NoYes = (name: "No" | "Yes") => enumValue("NoYes", name);
const Blocked = (name: "No" | "Invoice" | "All") => enumValue("CustVendorBlocked", name);
const ItemType = (name: "Item" | "Service" | "BOM") => enumValue("ItemType", name);
const SalesStatus = (name: "Backorder" | "Delivered" | "Invoiced" | "Canceled") =>
  enumValue("SalesStatus", name);
const PartyType = (name: "Person" | "Organization") => enumValue("DirPartyType", name);
const AccountType = (name: "Ledger" | "Cust" | "Vend" | "Bank") =>
  enumValue("LedgerJournalACType", name);
const LocationType = (name: "Standard" | "Transit" | "Quarantine") =>
  enumValue("InventLocationType", name);
const AccountClass = (name: "Revenue" | "Expense" | "Asset" | "Liability" | "Equity") =>
  enumValue("MainAccountType", name);

/** Stamps a company onto a block of rows so the tables below stay readable. */
const inCompany = (company: string, rows: Row[]): Row[] =>
  rows.map((row) => ({ ...row, DATAAREAID: company }));

// ---------------------------------------------------------------------------
// DirPartyTable — shared across all companies
// ---------------------------------------------------------------------------

const parties: Row[] = [
  { RECID: 5001, PartyNumber: "P-0001", Name: "Bramley & Fitch Retail", CountryRegionId: "GBR" },
  { RECID: 5002, PartyNumber: "P-0002", Name: "Otterbury Schools Trust", CountryRegionId: "GBR" },
  { RECID: 5003, PartyNumber: "P-0003", Name: "Larkfield Hospitality", CountryRegionId: "GBR" },
  { RECID: 5004, PartyNumber: "P-0004", Name: "Vellmar Interiors", CountryRegionId: "GBR" },
  { RECID: 5005, PartyNumber: "P-0005", Name: "Nordstrand Kontormøbler", CountryRegionId: "NOR" },
  { RECID: 5006, PartyNumber: "P-0006", Name: "Fjordvik Kommune", CountryRegionId: "NOR" },
  { RECID: 5007, PartyNumber: "P-0007", Name: "Halden Bruk AS", CountryRegionId: "NOR" },
  { RECID: 5008, PartyNumber: "P-0008", Name: "De Waal Kantoorinrichting", CountryRegionId: "NLD" },
  { RECID: 5009, PartyNumber: "P-0009", Name: "Zuiderveld Logistiek", CountryRegionId: "NLD" },
  { RECID: 5010, PartyNumber: "P-0010", Name: "Marijke Oosterhuis", CountryRegionId: "NLD" },
  { RECID: 5011, PartyNumber: "P-0011", Name: "Thorne Timber Supplies", CountryRegionId: "GBR" },
  { RECID: 5012, PartyNumber: "P-0012", Name: "Alvedal Metallverk", CountryRegionId: "SWE" },
  { RECID: 5013, PartyNumber: "P-0013", Name: "Peverell Fixings Co", CountryRegionId: "GBR" },
  { RECID: 5014, PartyNumber: "P-0014", Name: "Brecht Coatings NV", CountryRegionId: "BEL" },
].map((party) => ({
  ...party,
  PartyType: PartyType(party.PartyNumber === "P-0010" ? "Person" : "Organization"),
  DATAAREAID: SHARED_DATAAREAID,
}));

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const customers: Row[] = [
  ...inCompany("HVND", [
    // C-1000 also exists in KELT and MRDA, with different everything.
    {
      AccountNum: "C-1000",
      Party: 5001,
      CustGroup: "RETAIL",
      CurrencyCode: "GBP",
      PaymTermId: "N30",
      CreditMax: 50000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-1001",
      Party: 5002,
      CustGroup: "PUBLIC",
      CurrencyCode: "GBP",
      PaymTermId: "N60",
      CreditMax: 120000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-1002",
      Party: 5003,
      CustGroup: "RETAIL",
      CurrencyCode: "GBP",
      PaymTermId: "N30",
      CreditMax: 25000,
      Blocked: Blocked("Invoice"),
    },
    {
      AccountNum: "C-1003",
      Party: 5004,
      CustGroup: "TRADE",
      CurrencyCode: "EUR",
      PaymTermId: "N14",
      CreditMax: 8000,
      Blocked: Blocked("No"),
    },
  ]),
  ...inCompany("KELT", [
    {
      AccountNum: "C-1000",
      Party: 5005,
      CustGroup: "TRADE",
      CurrencyCode: "NOK",
      PaymTermId: "N14",
      CreditMax: 300000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-2001",
      Party: 5006,
      CustGroup: "PUBLIC",
      CurrencyCode: "NOK",
      PaymTermId: "N45",
      CreditMax: 750000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-2002",
      Party: 5007,
      CustGroup: "TRADE",
      CurrencyCode: "NOK",
      PaymTermId: "N30",
      CreditMax: 90000,
      Blocked: Blocked("All"),
    },
  ]),
  ...inCompany("MRDA", [
    {
      AccountNum: "C-1000",
      Party: 5008,
      CustGroup: "TRADE",
      CurrencyCode: "EUR",
      PaymTermId: "N30",
      CreditMax: 65000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-3001",
      Party: 5009,
      CustGroup: "TRADE",
      CurrencyCode: "EUR",
      PaymTermId: "N30",
      CreditMax: 40000,
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "C-3002",
      Party: 5010,
      CustGroup: "RETAIL",
      CurrencyCode: "EUR",
      PaymTermId: "N00",
      CreditMax: 2500,
      Blocked: Blocked("Invoice"),
    },
  ]),
];

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

const vendors: Row[] = [
  ...inCompany("HVND", [
    {
      AccountNum: "V-2000",
      Party: 5011,
      VendGroup: "TIMBER",
      CurrencyCode: "GBP",
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "V-2001",
      Party: 5013,
      VendGroup: "FIXINGS",
      CurrencyCode: "GBP",
      Blocked: Blocked("No"),
    },
  ]),
  ...inCompany("KELT", [
    {
      AccountNum: "V-2000",
      Party: 5012,
      VendGroup: "METAL",
      CurrencyCode: "SEK",
      Blocked: Blocked("No"),
    },
    {
      AccountNum: "V-4001",
      Party: 5011,
      VendGroup: "TIMBER",
      CurrencyCode: "GBP",
      Blocked: Blocked("Invoice"),
    },
  ]),
  ...inCompany("MRDA", [
    {
      AccountNum: "V-5000",
      Party: 5014,
      VendGroup: "COATING",
      CurrencyCode: "EUR",
      Blocked: Blocked("No"),
    },
  ]),
];

// ---------------------------------------------------------------------------
// Items
//
// The FURNITURE / RAWMAT split is what the lesson-schema worked example selects on.
// Every company has at least one already-stopped FURNITURE item so a learner's
// "block everything in FURNITURE" task has a no-op row to handle.
// ---------------------------------------------------------------------------

const items: Row[] = [
  ...inCompany("HVND", [
    {
      ItemId: "F-100",
      ItemName: "Ashwood desk 1400",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 184.5,
    },
    {
      ItemId: "F-101",
      ItemName: "Ashwood desk 1600",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 212.0,
    },
    {
      ItemId: "F-102",
      ItemName: "Pedestal drawer unit",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("Yes"),
      StandardCost: 96.75,
    },
    {
      ItemId: "F-103",
      ItemName: "Meeting table 2400",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 341.0,
    },
    {
      ItemId: "R-200",
      ItemName: "Ash board 25mm",
      ItemGroupId: "RAWMAT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 22.4,
    },
    {
      ItemId: "R-201",
      ItemName: "Birch ply 18mm",
      ItemGroupId: "RAWMAT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 17.8,
    },
    {
      ItemId: "C-300",
      ItemName: "Levelling foot M8",
      ItemGroupId: "COMPONENT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 0.42,
    },
    {
      ItemId: "S-900",
      ItemName: "On-site assembly",
      ItemGroupId: "SERVICE",
      ItemType: ItemType("Service"),
      Blocked: NoYes("No"),
      StandardCost: 0,
    },
  ]),
  ...inCompany("KELT", [
    {
      ItemId: "F-100",
      ItemName: "Eikebord 1400",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 2140.0,
    },
    {
      ItemId: "F-110",
      ItemName: "Hev-senk stativ",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 3120.0,
    },
    {
      ItemId: "F-111",
      ItemName: "Arkivskap 3H",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("Yes"),
      StandardCost: 1890.0,
    },
    {
      ItemId: "R-210",
      ItemName: "Stålramme 40x40",
      ItemGroupId: "RAWMAT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 260.0,
    },
    {
      ItemId: "C-310",
      ItemName: "Kabelgjennomføring",
      ItemGroupId: "COMPONENT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 18.5,
    },
  ]),
  ...inCompany("MRDA", [
    {
      ItemId: "F-120",
      ItemName: "Bureaustoel Delta",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 148.0,
    },
    {
      ItemId: "F-121",
      ItemName: "Vergadertafel rond",
      ItemGroupId: "FURNITURE",
      ItemType: ItemType("Item"),
      Blocked: NoYes("Yes"),
      StandardCost: 275.0,
    },
    {
      ItemId: "R-220",
      ItemName: "MDF plaat 22mm",
      ItemGroupId: "RAWMAT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 14.25,
    },
    {
      ItemId: "C-320",
      ItemName: "Zwenkwiel 50mm",
      ItemGroupId: "COMPONENT",
      ItemType: ItemType("Item"),
      Blocked: NoYes("No"),
      StandardCost: 1.95,
    },
  ]),
];

// ---------------------------------------------------------------------------
// Warehouses and locations
// ---------------------------------------------------------------------------

const warehouses: Row[] = [
  ...inCompany("HVND", [
    {
      InventLocationId: "MAIN",
      Name: "Havensdale main store",
      InventSiteId: "SITE-1",
      InventLocationType: LocationType("Standard"),
    },
    {
      InventLocationId: "QUAR",
      Name: "Quarantine bay",
      InventSiteId: "SITE-1",
      InventLocationType: LocationType("Quarantine"),
    },
  ]),
  ...inCompany("KELT", [
    {
      InventLocationId: "OSLO",
      Name: "Oslo lager",
      InventSiteId: "SITE-N1",
      InventLocationType: LocationType("Standard"),
    },
    {
      InventLocationId: "TRAN",
      Name: "Transitt",
      InventSiteId: "SITE-N1",
      InventLocationType: LocationType("Transit"),
    },
  ]),
  ...inCompany("MRDA", [
    {
      InventLocationId: "UTRE",
      Name: "Utrecht magazijn",
      InventSiteId: "SITE-M1",
      InventLocationType: LocationType("Standard"),
    },
  ]),
];

const wmsLocations: Row[] = [
  ...inCompany("HVND", [
    { WMSLocationId: "A-01-1", InventLocationId: "MAIN", Aisle: "A", Rack: "01", Shelf: "1" },
    { WMSLocationId: "A-01-2", InventLocationId: "MAIN", Aisle: "A", Rack: "01", Shelf: "2" },
    { WMSLocationId: "B-04-1", InventLocationId: "MAIN", Aisle: "B", Rack: "04", Shelf: "1" },
    { WMSLocationId: "Q-01-1", InventLocationId: "QUAR", Aisle: "Q", Rack: "01", Shelf: "1" },
  ]),
  ...inCompany("KELT", [
    { WMSLocationId: "1-01-A", InventLocationId: "OSLO", Aisle: "1", Rack: "01", Shelf: "A" },
    { WMSLocationId: "1-02-A", InventLocationId: "OSLO", Aisle: "1", Rack: "02", Shelf: "A" },
  ]),
  ...inCompany("MRDA", [
    { WMSLocationId: "M-01", InventLocationId: "UTRE", Aisle: "M", Rack: "01", Shelf: "1" },
  ]),
];

const onHand: Row[] = [
  ...inCompany("HVND", [
    {
      ItemId: "F-100",
      InventLocationId: "MAIN",
      PhysicalInvent: 42,
      AvailPhysical: 38,
      PostedQty: 42,
    },
    {
      ItemId: "F-101",
      InventLocationId: "MAIN",
      PhysicalInvent: 17,
      AvailPhysical: 17,
      PostedQty: 17,
    },
    {
      ItemId: "F-103",
      InventLocationId: "MAIN",
      PhysicalInvent: 4,
      AvailPhysical: 2,
      PostedQty: 4,
    },
    {
      ItemId: "R-200",
      InventLocationId: "MAIN",
      PhysicalInvent: 610,
      AvailPhysical: 610,
      PostedQty: 610,
    },
    {
      ItemId: "R-201",
      InventLocationId: "MAIN",
      PhysicalInvent: 285,
      AvailPhysical: 250,
      PostedQty: 285,
    },
    {
      ItemId: "C-300",
      InventLocationId: "MAIN",
      PhysicalInvent: 4800,
      AvailPhysical: 4800,
      PostedQty: 4800,
    },
    {
      ItemId: "F-102",
      InventLocationId: "QUAR",
      PhysicalInvent: 6,
      AvailPhysical: 0,
      PostedQty: 6,
    },
  ]),
  ...inCompany("KELT", [
    {
      ItemId: "F-100",
      InventLocationId: "OSLO",
      PhysicalInvent: 9,
      AvailPhysical: 9,
      PostedQty: 9,
    },
    {
      ItemId: "F-110",
      InventLocationId: "OSLO",
      PhysicalInvent: 23,
      AvailPhysical: 20,
      PostedQty: 23,
    },
    {
      ItemId: "R-210",
      InventLocationId: "OSLO",
      PhysicalInvent: 140,
      AvailPhysical: 140,
      PostedQty: 140,
    },
  ]),
  ...inCompany("MRDA", [
    {
      ItemId: "F-120",
      InventLocationId: "UTRE",
      PhysicalInvent: 88,
      AvailPhysical: 71,
      PostedQty: 88,
    },
    {
      ItemId: "R-220",
      InventLocationId: "UTRE",
      PhysicalInvent: 320,
      AvailPhysical: 320,
      PostedQty: 320,
    },
  ]),
];

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

const salesOrders: Row[] = [
  ...inCompany("HVND", [
    {
      SalesId: "SO-0001",
      SalesName: "Bramley & Fitch Q3 refit",
      CustAccount: "C-1000",
      SalesStatus: SalesStatus("Backorder"),
      DeliveryDate: "2026-09-14",
      CurrencyCode: "GBP",
    },
    {
      SalesId: "SO-0002",
      SalesName: "Otterbury classroom desks",
      CustAccount: "C-1001",
      SalesStatus: SalesStatus("Delivered"),
      DeliveryDate: "2026-07-30",
      CurrencyCode: "GBP",
    },
    {
      SalesId: "SO-0003",
      SalesName: "Larkfield lobby",
      CustAccount: "C-1002",
      SalesStatus: SalesStatus("Invoiced"),
      DeliveryDate: "2026-06-18",
      CurrencyCode: "GBP",
    },
  ]),
  ...inCompany("KELT", [
    {
      SalesId: "SO-0001",
      SalesName: "Nordstrand pilotparti",
      CustAccount: "C-1000",
      SalesStatus: SalesStatus("Backorder"),
      DeliveryDate: "2026-09-01",
      CurrencyCode: "NOK",
    },
    {
      SalesId: "SO-0101",
      SalesName: "Fjordvik rådhus",
      CustAccount: "C-2001",
      SalesStatus: SalesStatus("Delivered"),
      DeliveryDate: "2026-08-05",
      CurrencyCode: "NOK",
    },
  ]),
  ...inCompany("MRDA", [
    {
      SalesId: "SO-0201",
      SalesName: "De Waal najaarslevering",
      CustAccount: "C-1000",
      SalesStatus: SalesStatus("Backorder"),
      DeliveryDate: "2026-10-02",
      CurrencyCode: "EUR",
    },
    {
      SalesId: "SO-0202",
      SalesName: "Zuiderveld kantoor",
      CustAccount: "C-3001",
      SalesStatus: SalesStatus("Canceled"),
      DeliveryDate: "2026-08-21",
      CurrencyCode: "EUR",
    },
  ]),
];

const salesLines: Row[] = [
  ...inCompany("HVND", [
    {
      SalesId: "SO-0001",
      LineNum: 1,
      ItemId: "F-100",
      SalesQty: 12,
      SalesPrice: 349.0,
      LineAmount: 4188.0,
      InventLocationId: "MAIN",
    },
    {
      SalesId: "SO-0001",
      LineNum: 2,
      ItemId: "C-300",
      SalesQty: 48,
      SalesPrice: 1.2,
      LineAmount: 57.6,
      InventLocationId: "MAIN",
    },
    {
      SalesId: "SO-0002",
      LineNum: 1,
      ItemId: "F-101",
      SalesQty: 30,
      SalesPrice: 398.0,
      LineAmount: 11940.0,
      InventLocationId: "MAIN",
    },
    // F-100 a second time, on a different order. Deliberate: without an item that
    // appears on more than one line, the reporting lesson's "aggregate in the provider"
    // exercise would produce exactly the same row count as the detail one and teach
    // nothing.
    {
      SalesId: "SO-0002",
      LineNum: 2,
      ItemId: "F-100",
      SalesQty: 5,
      SalesPrice: 349.0,
      LineAmount: 1745.0,
      InventLocationId: "MAIN",
    },
    {
      SalesId: "SO-0003",
      LineNum: 1,
      ItemId: "F-103",
      SalesQty: 2,
      SalesPrice: 640.0,
      LineAmount: 1280.0,
      InventLocationId: "MAIN",
    },
    {
      SalesId: "SO-0003",
      LineNum: 2,
      ItemId: "S-900",
      SalesQty: 1,
      SalesPrice: 250.0,
      LineAmount: 250.0,
      InventLocationId: "MAIN",
    },
  ]),
  ...inCompany("KELT", [
    {
      SalesId: "SO-0001",
      LineNum: 1,
      ItemId: "F-100",
      SalesQty: 4,
      SalesPrice: 4100.0,
      LineAmount: 16400.0,
      InventLocationId: "OSLO",
    },
    {
      SalesId: "SO-0101",
      LineNum: 1,
      ItemId: "F-110",
      SalesQty: 15,
      SalesPrice: 5850.0,
      LineAmount: 87750.0,
      InventLocationId: "OSLO",
    },
  ]),
  ...inCompany("MRDA", [
    {
      SalesId: "SO-0201",
      LineNum: 1,
      ItemId: "F-120",
      SalesQty: 25,
      SalesPrice: 289.0,
      LineAmount: 7225.0,
      InventLocationId: "UTRE",
    },
    {
      SalesId: "SO-0202",
      LineNum: 1,
      ItemId: "R-220",
      SalesQty: 60,
      SalesPrice: 26.5,
      LineAmount: 1590.0,
      InventLocationId: "UTRE",
    },
  ]),
];

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const mainAccounts: Row[] = ["HVND", "KELT", "MRDA"].flatMap((company) =>
  inCompany(company, [
    {
      MainAccountId: "110100",
      Name: "Bank current account",
      Type: AccountClass("Asset"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "130100",
      Name: "Accounts receivable",
      Type: AccountClass("Asset"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "140100",
      Name: "Inventory, finished goods",
      Type: AccountClass("Asset"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "200100",
      Name: "Accounts payable",
      Type: AccountClass("Liability"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "300100",
      Name: "Retained earnings",
      Type: AccountClass("Equity"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "400100",
      Name: "Product revenue",
      Type: AccountClass("Revenue"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "500100",
      Name: "Cost of goods sold",
      Type: AccountClass("Expense"),
      CurrencyCode: "",
    },
    {
      MainAccountId: "600100",
      Name: "Office costs",
      Type: AccountClass("Expense"),
      CurrencyCode: "",
    },
  ]),
);

const journals: Row[] = [
  ...inCompany("HVND", [
    {
      JournalNum: "J-000123",
      JournalName: "GenJrn",
      Name: "August accruals",
      Posted: NoYes("No"),
      PostedDateTime: "",
    },
    {
      JournalNum: "J-000124",
      JournalName: "GenJrn",
      Name: "July close",
      Posted: NoYes("Yes"),
      PostedDateTime: "2026-08-01",
    },
  ]),
  ...inCompany("KELT", [
    {
      JournalNum: "J-000301",
      JournalName: "GenJrn",
      Name: "Periodisering august",
      Posted: NoYes("No"),
      PostedDateTime: "",
    },
  ]),
  ...inCompany("MRDA", [
    {
      JournalNum: "J-000501",
      JournalName: "GenJrn",
      Name: "Maandafsluiting juli",
      Posted: NoYes("Yes"),
      PostedDateTime: "2026-08-03",
    },
  ]),
];

const journalLines: Row[] = [
  ...inCompany("HVND", [
    {
      JournalNum: "J-000123",
      Voucher: "GJ-00045",
      TransDate: "2026-08-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "600100",
      Txt: "Accrued office costs",
      AmountCurDebit: 1250.0,
      AmountCurCredit: 0,
      CurrencyCode: "GBP",
    },
    {
      JournalNum: "J-000123",
      Voucher: "GJ-00045",
      TransDate: "2026-08-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "200100",
      Txt: "Accrued office costs",
      AmountCurDebit: 0,
      AmountCurCredit: 1250.0,
      CurrencyCode: "GBP",
    },
    {
      JournalNum: "J-000124",
      Voucher: "GJ-00044",
      TransDate: "2026-07-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "500100",
      Txt: "July COGS",
      AmountCurDebit: 18400.0,
      AmountCurCredit: 0,
      CurrencyCode: "GBP",
    },
    {
      JournalNum: "J-000124",
      Voucher: "GJ-00044",
      TransDate: "2026-07-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "140100",
      Txt: "July COGS",
      AmountCurDebit: 0,
      AmountCurCredit: 18400.0,
      CurrencyCode: "GBP",
    },
  ]),
  ...inCompany("KELT", [
    {
      JournalNum: "J-000301",
      Voucher: "GJ-00110",
      TransDate: "2026-08-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "600100",
      Txt: "Kontorkostnader",
      AmountCurDebit: 9400.0,
      AmountCurCredit: 0,
      CurrencyCode: "NOK",
    },
    {
      JournalNum: "J-000301",
      Voucher: "GJ-00110",
      TransDate: "2026-08-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "200100",
      Txt: "Kontorkostnader",
      AmountCurDebit: 0,
      AmountCurCredit: 9400.0,
      CurrencyCode: "NOK",
    },
  ]),
  ...inCompany("MRDA", [
    {
      JournalNum: "J-000501",
      Voucher: "GJ-00210",
      TransDate: "2026-07-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "400100",
      Txt: "Omzet juli",
      AmountCurDebit: 0,
      AmountCurCredit: 24150.0,
      CurrencyCode: "EUR",
    },
    {
      JournalNum: "J-000501",
      Voucher: "GJ-00210",
      TransDate: "2026-07-31",
      AccountType: AccountType("Ledger"),
      LedgerDimension: "130100",
      Txt: "Omzet juli",
      AmountCurDebit: 24150.0,
      AmountCurCredit: 0,
      CurrencyCode: "EUR",
    },
  ]),
];

const customerTransactions: Row[] = [
  ...inCompany("HVND", [
    {
      AccountNum: "C-1000",
      Voucher: "SI-00301",
      TransDate: "2026-06-30",
      Invoice: "INV-00301",
      AmountMST: 4188.0,
      AmountCur: 4188.0,
      CurrencyCode: "GBP",
      Closed: "",
    },
    {
      AccountNum: "C-1000",
      Voucher: "SI-00318",
      TransDate: "2026-07-28",
      Invoice: "INV-00318",
      AmountMST: 1930.5,
      AmountCur: 1930.5,
      CurrencyCode: "GBP",
      Closed: "2026-08-14",
    },
    {
      AccountNum: "C-1001",
      Voucher: "SI-00322",
      TransDate: "2026-07-30",
      Invoice: "INV-00322",
      AmountMST: 11940.0,
      AmountCur: 11940.0,
      CurrencyCode: "GBP",
      Closed: "",
    },
    {
      AccountNum: "C-1002",
      Voucher: "SI-00287",
      TransDate: "2026-06-18",
      Invoice: "INV-00287",
      AmountMST: 1530.0,
      AmountCur: 1530.0,
      CurrencyCode: "GBP",
      Closed: "",
    },
  ]),
  ...inCompany("KELT", [
    {
      AccountNum: "C-1000",
      Voucher: "SI-00902",
      TransDate: "2026-07-11",
      Invoice: "INV-00902",
      AmountMST: 16400.0,
      AmountCur: 16400.0,
      CurrencyCode: "NOK",
      Closed: "",
    },
    {
      AccountNum: "C-2001",
      Voucher: "SI-00915",
      TransDate: "2026-08-05",
      Invoice: "INV-00915",
      AmountMST: 87750.0,
      AmountCur: 87750.0,
      CurrencyCode: "NOK",
      Closed: "",
    },
  ]),
  ...inCompany("MRDA", [
    {
      AccountNum: "C-1000",
      Voucher: "SI-01204",
      TransDate: "2026-07-19",
      Invoice: "INV-01204",
      AmountMST: 7225.0,
      AmountCur: 7225.0,
      CurrencyCode: "EUR",
      Closed: "",
    },
    {
      AccountNum: "C-3001",
      Voucher: "SI-01210",
      TransDate: "2026-08-02",
      Invoice: "INV-01210",
      AmountMST: 3410.0,
      AmountCur: 3410.0,
      CurrencyCode: "EUR",
      Closed: "2026-08-20",
    },
  ]),
];

// ---------------------------------------------------------------------------
// Financial dimensions — shared, like the framework's tables really are
//
// Five dimensions, a handful of values, and three sets wired onto master records. RECIDs
// are assigned by hand so the foreign keys are stable across reseeds and so a lesson can
// quote one in prose without it drifting.
//
// The fourth set, 6304, is deliberately empty. VB-028: the framework stores no row for a
// dimension with no value, so an empty set is a set with no items — and a learner who has
// seen that stops expecting a blank row to be there.
// ---------------------------------------------------------------------------

const dimensionAttributes: Row[] = [
  { RECID: 6001, Name: "BusinessUnit", BackingEntityType: "Custom" },
  { RECID: 6002, Name: "CostCenter", BackingEntityType: "Custom" },
  { RECID: 6003, Name: "Department", BackingEntityType: "Custom" },
  // VB-032: an entity-backed dimension takes its values from another table rather than
  // from the Financial dimension values page.
  { RECID: 6004, Name: "ItemGroup", BackingEntityType: "Entity" },
  { RECID: 6005, Name: "Project", BackingEntityType: "Custom" },
].map((attribute) => ({ ...attribute, DATAAREAID: SHARED_DATAAREAID }));

const dimensionValues: Row[] = [
  { RECID: 6101, DimensionAttribute: 6001, DisplayValue: "BU-01", Description: "Furniture" },
  { RECID: 6102, DimensionAttribute: 6001, DisplayValue: "BU-02", Description: "Trading" },
  { RECID: 6111, DimensionAttribute: 6002, DisplayValue: "CC-100", Description: "Workshop" },
  { RECID: 6112, DimensionAttribute: 6002, DisplayValue: "CC-200", Description: "Warehouse" },
  { RECID: 6113, DimensionAttribute: 6002, DisplayValue: "CC-300", Description: "Head office" },
  { RECID: 6121, DimensionAttribute: 6003, DisplayValue: "DEP-10", Description: "Sales" },
  { RECID: 6122, DimensionAttribute: 6003, DisplayValue: "DEP-20", Description: "Operations" },
  { RECID: 6131, DimensionAttribute: 6004, DisplayValue: "FURNITURE", Description: "Furniture" },
  { RECID: 6132, DimensionAttribute: 6004, DisplayValue: "RAWMAT", Description: "Raw materials" },
  {
    RECID: 6141,
    DimensionAttribute: 6005,
    DisplayValue: "PRJ-001",
    Description: "Otterbury fit-out",
  },
  {
    RECID: 6142,
    DimensionAttribute: 6005,
    DisplayValue: "PRJ-002",
    Description: "Larkfield refresh",
  },
].map((value) => ({ ...value, DATAAREAID: SHARED_DATAAREAID }));

const dimensionSets: Row[] = [
  { RECID: 6301, Hash: "CostCenter=CC-100;Department=DEP-10" },
  { RECID: 6302, Hash: "CostCenter=CC-200;ItemGroup=FURNITURE" },
  { RECID: 6303, Hash: "Department=DEP-20;Project=PRJ-001" },
  { RECID: 6304, Hash: "" },
].map((set) => ({ ...set, DATAAREAID: SHARED_DATAAREAID }));

const dimensionSetItems: Row[] = [
  // 6301 — on customer C-1000 in HVND.
  { DimensionAttributeValueSet: 6301, DimensionAttributeValue: 6111, DisplayValue: "CC-100" },
  { DimensionAttributeValueSet: 6301, DimensionAttributeValue: 6121, DisplayValue: "DEP-10" },
  // 6302 — on item F-100 in HVND.
  { DimensionAttributeValueSet: 6302, DimensionAttributeValue: 6112, DisplayValue: "CC-200" },
  { DimensionAttributeValueSet: 6302, DimensionAttributeValue: 6131, DisplayValue: "FURNITURE" },
  // 6303 — on sales order SO-0001 in HVND.
  { DimensionAttributeValueSet: 6303, DimensionAttributeValue: 6122, DisplayValue: "DEP-20" },
  { DimensionAttributeValueSet: 6303, DimensionAttributeValue: 6141, DisplayValue: "PRJ-001" },
  // 6304 has no items at all, and that is not a mistake — see VB-028.
].map((item) => ({ ...item, DATAAREAID: SHARED_DATAAREAID }));

/**
 * Points a master record at a dimension set.
 *
 * Applied after the fact rather than inline, so the customer and item tables above stay
 * readable and the dimension wiring lives in one place next to the sets themselves.
 */
const withDefaultDimension = (
  source: readonly Row[],
  assignments: { company: string; key: string; keyField: string; set: number }[],
): Row[] =>
  source.map((row) => {
    const match = assignments.find(
      (assignment) =>
        row["DATAAREAID"] === assignment.company && row[assignment.keyField] === assignment.key,
    );
    return { ...row, DefaultDimension: match?.set ?? 0 };
  });

const rows: Partial<Record<TableName, readonly Row[]>> = {
  DirPartyTable: parties,
  CustTable: withDefaultDimension(customers, [
    { company: "HVND", key: "C-1000", keyField: "AccountNum", set: 6301 },
  ]),
  CustTrans: customerTransactions,
  VendTable: vendors,
  InventTable: withDefaultDimension(items, [
    { company: "HVND", key: "F-100", keyField: "ItemId", set: 6302 },
  ]),
  InventSum: onHand,
  InventLocation: warehouses,
  WMSLocation: wmsLocations,
  SalesTable: withDefaultDimension(salesOrders, [
    { company: "HVND", key: "SO-0001", keyField: "SalesId", set: 6303 },
  ]),
  // Lines carry the field but no values, which is the ordinary starting state: dimensions
  // arrive on a line by being copied or merged from somewhere else.
  SalesLine: withDefaultDimension(salesLines, []),
  MainAccount: mainAccounts,
  LedgerJournalTable: journals,
  LedgerJournalTrans: journalLines,
  DimensionAttribute: dimensionAttributes,
  DimensionAttributeValue: dimensionValues,
  DimensionAttributeValueSet: dimensionSets,
  DimensionAttributeValueSetItem: dimensionSetItems,
};

export const defaultSeed: SeedDefinition = {
  name: "default",
  description:
    "Three fictional legal entities — a UK furniture maker, its Norwegian sister company and a Dutch trading arm — with customers, items, stock, sales orders and a general journal in each.",
  rows,
};
