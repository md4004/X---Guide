/**
 * Plausible wrong answers, each paired with the message it should produce.
 *
 * `lesson.test.ts` proves the solutions work. This file proves the *failures* work, which
 * is the harder and more valuable half: a validator set where every mistake trips the
 * same generic check tells a learner they are wrong without telling them how.
 *
 * Two authoring defects have been caught here so far, both invisible to a test that only
 * asserted "this fails":
 *   - solving lesson 2's first task with `while select` was reported as "there is no
 *     select statement", which sent the learner looking for the wrong thing
 *   - forgetting `update()` was reported as writing outside a transaction, because
 *     "every mutation is in a transaction" is vacuously false when there are none
 *
 * Both were fixed in the content — reordering validators, adding a specific one — with no
 * engine change, which is what the Phase 5 criterion was asking for.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runTask } from "../src/index";
import type { TaskDefinition, TaskResult } from "../src/index";
import { lessonList } from "./lessons";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

function taskFor(lessonSlug: string, taskId: string): TaskDefinition {
  const lesson = lessonList().find(([slug]) => slug === lessonSlug)?.[1];
  const task = lesson?.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) throw new Error(`No task ${lessonSlug}/${taskId}`);
  return task;
}

/**
 * What the learner actually reads back.
 *
 * Two things can speak. If the code fails at runtime the engine's own error wins, and
 * that is right: writing outside a transaction produces F&O's own message with its own
 * hint, which beats anything an author would write. A validator message only appears
 * when the code ran cleanly but did the wrong thing.
 */
function feedbackFor(result: TaskResult): string {
  if (result.failure?.message !== undefined) return result.failure.message;
  return result.runtimeErrors.map((error) => `${error.message} ${error.hint ?? ""}`).join("\n");
}

interface WrongAnswer {
  lesson: string;
  task: string;
  label: string;
  source: string;
  /** A fragment of the message that specifically addresses this mistake. */
  expect: string;
}

const WRONG: WrongAnswer[] = [
  // -- 01 Hello Infolog ----------------------------------------------------
  {
    lesson: "01-hello-infolog",
    task: "three-levels",
    label: "uses info for all three levels",
    source: 'info("Starting");\ninfo("Careful");\ninfo("Stopped");',
    expect: "warning() is its own function",
  },
  {
    lesson: "01-hello-infolog",
    task: "format-a-message",
    label: "concatenates instead of using strFmt",
    source:
      'str company = "Havensdale";\nint itemCount = 4;\ninfo(company + " has " + int2Str(itemCount) + " items");',
    expect: "Build the message with strFmt",
  },
  {
    lesson: "01-hello-infolog",
    task: "format-a-message",
    label: "forgets the second argument",
    source:
      'str company = "Havensdale";\nint itemCount = 4;\ninfo(strFmt("%1 has %2 items", company));',
    expect: "leftover %2",
  },

  // -- 02 Buffers and select -----------------------------------------------
  {
    lesson: "02-buffers-and-select",
    task: "select-one-item",
    label: "loops the whole table instead of selecting one",
    source:
      'InventTable inventTable;\nwhile select inventTable\n{\n    if (inventTable.ItemId == "F-100")\n    {\n        info(inventTable.ItemName);\n    }\n}',
    expect: "walks the whole table",
  },
  {
    lesson: "02-buffers-and-select",
    task: "select-one-item",
    label: "omits firstonly",
    source:
      'InventTable inventTable;\nselect inventTable where inventTable.ItemId == "F-100";\ninfo(inventTable.ItemName);',
    expect: "fetches the whole result set",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "forgets forupdate",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "read-only",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "sets the field but never calls update",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "only changes the buffer in memory",
  },
  {
    lesson: "02-buffers-and-select",
    task: "block-furniture",
    label: "blocks every group, not just FURNITURE",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\nwhile select forupdate inventTable\n{\n    inventTable.Blocked = NoYes::Yes;\n    inventTable.update();\n    counter++;\n}\nttscommit;\ninfo(strFmt("Blocked %1 items", counter));',
    expect: "outside the FURNITURE group",
  },

  // -- 03 Transactions -----------------------------------------------------
  {
    lesson: "03-transactions",
    task: "wrap-a-write",
    label: "writes with no transaction at all",
    source:
      'CustTable custTable;\nselect forupdate custTable where custTable.AccountNum == "C-1000";\ncustTable.CreditMax = 75000;\ncustTable.update();\ninfo("Credit limit updated");',
    expect: "not allowed outside a transaction scope",
  },
  {
    lesson: "03-transactions",
    task: "abort-discards-everything",
    label: "commits the inner level instead of aborting",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\ninventTable.ItemId = "F-800";\ninventTable.ItemName = "Outer";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\nttsbegin;\ninventTable.clear();\ninventTable.ItemId = "F-801";\ninventTable.ItemName = "Inner";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\nttscommit;\nttscommit;\nwhile select inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    counter++;\n}\ninfo(strFmt("Survived: %1", counter));',
    expect: "This step is about ttsabort",
  },

  // -- 04 Insert, update, delete -------------------------------------------
  {
    lesson: "04-insert-update-delete",
    task: "two-inserts-and-clear",
    label: "forgets clear() between the inserts",
    source:
      'InventTable inventTable;\nttsbegin;\ninventTable.ItemId = "F-600";\ninventTable.ItemName = "First";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\ninventTable.ItemId = "F-601";\ninventTable.ItemName = "Second";\ninventTable.insert();\nttscommit;\ninfo("Inserted two items");',
    expect: "no call to clear()",
  },
  {
    lesson: "04-insert-update-delete",
    task: "update-a-record",
    label: "reads without forupdate",
    source:
      'InventTable inventTable;\nttsbegin;\nselect inventTable where inventTable.ItemId == "F-100";\ninventTable.ItemName = "Ashwood desk 1400 (refreshed)";\ninventTable.Blocked = NoYes::Yes;\ninventTable.update();\nttscommit;\ninfo("Updated F-100");',
    // The runtime answers this one before any validator runs, and its message is better.
    expect: "not selected for update",
  },

  // -- 05 Joins ------------------------------------------------------------
  {
    lesson: "05-joins",
    task: "join-orders-and-lines",
    label: "nests a select inside the loop, the C/AL way",
    source:
      'SalesTable salesTable;\nSalesLine salesLine;\nint counter;\nwhile select salesTable\n{\n    while select salesLine where salesLine.SalesId == salesTable.SalesId\n    {\n        info(strFmt("%1 / %2", salesTable.SalesId, salesLine.ItemId));\n        counter++;\n    }\n}\ninfo(strFmt("%1 lines", counter));',
    expect: "ran more than one query",
  },
  {
    lesson: "05-joins",
    task: "customers-with-orders",
    label: "uses a plain join, so customers repeat",
    source:
      'CustTable custTable;\nSalesTable salesTable;\nint counter;\nwhile select custTable\n    join salesTable\n    where salesTable.CustAccount == custTable.AccountNum\n{\n    info(custTable.AccountNum);\n    counter++;\n}\ninfo(strFmt("%1 customers with orders", counter));',
    expect: "no EXISTS in it",
  },

  // -- 06 Set-based --------------------------------------------------------
  {
    lesson: "06-set-based",
    task: "block-with-update-recordset",
    label: "right rows, wrong number of statements",
    source:
      'InventTable inventTable;\nttsbegin;\nwhile select forupdate inventTable where inventTable.ItemGroupId == "FURNITURE"\n{\n    inventTable.Blocked = NoYes::Yes;\n    inventTable.update();\n}\nttscommit;\ninfo("Blocked in one statement");',
    expect: "look at the SQL trace",
  },
  {
    lesson: "06-set-based",
    task: "delete-a-group",
    label: "deletes everything, not just COMPONENT",
    source:
      'InventTable inventTable;\nint counter;\nttsbegin;\ndelete_from inventTable;\nttscommit;\nwhile select inventTable\n{\n    counter++;\n}\ninfo(strFmt("%1 items remain", counter));',
    expect: "FURNITURE items are gone too",
  },

  // -- 07 Companies --------------------------------------------------------
  {
    lesson: "07-companies",
    task: "count-in-another-company",
    label: "counts this company instead of KELT",
    source:
      'CustTable custTable;\nint counter;\nwhile select custTable\n{\n    counter++;\n}\ninfo(strFmt("KELT has %1 customers", counter));',
    expect: "no changecompany block",
  },
  {
    lesson: "07-companies",
    task: "count-across-companies",
    label: "forgets crosscompany",
    source:
      'CustTable custTable;\nint counter;\nwhile select custTable\n{\n    counter++;\n}\ninfo(strFmt("%1 customers in total", counter));',
    expect: "Use crosscompany",
  },
  {
    lesson: "07-companies",
    task: "same-key-different-row",
    label: "does not re-select inside the changecompany block",
    source:
      'CustTable custTable;\nselect firstonly custTable where custTable.AccountNum == "C-1000";\ninfo(strFmt("HVND %1", custTable.CurrencyCode));\nchangecompany ("KELT")\n{\n    info(strFmt("KELT %1", custTable.CurrencyCode));\n}',
    expect: "did not re-select inside the changecompany block",
  },

  // -- 08 Exceptions -------------------------------------------------------
  {
    lesson: "08-exceptions",
    task: "throw-and-catch",
    label: "throws the bare enum, so nothing is logged",
    source:
      'try\n{\n    throw Exception::Error;\n}\ncatch (Exception::Error)\n{\n    info("Recovered");\n}',
    expect: "bare throw Exception::Error writes nothing",
  },
  {
    lesson: "08-exceptions",
    task: "catch-outside-the-transaction",
    label: "puts the catch inside the transaction, where it never fires",
    source:
      'ttsbegin;\ntry\n{\n    throw error("failed inside the transaction");\n}\ncatch (Exception::Error)\n{\n    info("Caught outside");\n}\nttscommit;',
    expect: "cannot be caught by a catch that is also inside it",
  },
  {
    lesson: "08-exceptions",
    task: "retry-until-it-works",
    label: "loops with a while instead of retry",
    source:
      'int attempts;\nwhile (attempts < 3)\n{\n    info(strFmt("attempt %1", attempts));\n    attempts++;\n}\ninfo("Succeeded");',
    expect: "no retry statement",
  },

  // -- 09 Forms ------------------------------------------------------------
  {
    lesson: "09-forms",
    task: "reject-a-record",
    label: "decides for itself instead of asking validateWrite",
    source:
      'InventTable inventTable;\n\ninventTable.ItemName = "A desk with no item number";\n\nif (!inventTable.ItemId)\n{\n    info("Rejected");\n}',
    expect: "Nothing calls validateWrite()",
  },
  {
    lesson: "09-forms",
    task: "reject-a-record",
    label: "fills in every field, so there is nothing to reject",
    source:
      'InventTable inventTable;\n\ninventTable.ItemId = "F-800";\ninventTable.ItemName = "A perfectly valid desk";\n\nif (!inventTable.validateWrite())\n{\n    info("Rejected");\n}',
    expect: "the record it looked at was already valid",
  },
  {
    lesson: "09-forms",
    task: "validate-then-insert",
    label: "inserts without validating, which is what insert() lets you do",
    source:
      'InventTable inventTable;\n\nttsbegin;\ninventTable.ItemId = "F-700";\ninventTable.ItemName = "Validated desk";\ninventTable.ItemGroupId = "FURNITURE";\ninventTable.insert();\nttscommit;\n\ninfo("Inserted after validating");',
    expect: "insert() will not call it for you",
  },

  // -- 10 Reports ----------------------------------------------------------
  {
    lesson: "10-reports",
    task: "fill-the-table",
    label: "forgets clear(), so every row inherits the first one's item",
    source:
      'SalesLine salesLine;\nInventTable inventTable;\nTmpItemSales tmpItemSales;\nint counter;\n\nttsbegin;\nwhile select salesLine\n    join inventTable\n    where inventTable.ItemId == salesLine.ItemId\n{\n    tmpItemSales.SalesQty = salesLine.SalesQty;\n    tmpItemSales.LineAmount = salesLine.LineAmount;\n    tmpItemSales.insert();\n    counter++;\n}\nttscommit;\n\ninfo(strFmt("Provider wrote %1 rows", counter));',
    expect: "no clear() in the loop",
  },
  {
    lesson: "10-reports",
    task: "aggregate-first",
    label: "writes one row per line, so nothing was aggregated",
    source:
      'SalesLine salesLine;\nInventTable inventTable;\nTmpItemSales tmpItemSales;\nint counter;\n\nttsbegin;\nwhile select salesLine\n    join inventTable\n    where inventTable.ItemId == salesLine.ItemId\n{\n    tmpItemSales.clear();\n    tmpItemSales.ItemGroupId = inventTable.ItemGroupId;\n    tmpItemSales.ItemId = inventTable.ItemId;\n    tmpItemSales.ItemName = inventTable.ItemName;\n    tmpItemSales.SalesQty = salesLine.SalesQty;\n    tmpItemSales.LineAmount = salesLine.LineAmount;\n    tmpItemSales.insert();\n    counter++;\n}\nttscommit;\n\ninfo(strFmt("Aggregated to %1 rows", counter));',
    expect: "Six means you are still writing one row per line",
  },

  // -- 11 Financial dimensions ---------------------------------------------
  {
    lesson: "11-financial-dimensions",
    task: "follow-the-chain",
    label: "walks every set item, not just the customer's",
    source:
      'CustTable custTable;\nDimensionAttributeValueSetItem setItem;\nDimensionAttributeValue dimensionValue;\nDimensionAttribute dimensionAttribute;\n\nselect firstonly custTable where custTable.AccountNum == "C-1000";\n\nwhile select setItem\n    join dimensionValue\n    where dimensionValue.RecId == setItem.DimensionAttributeValue\n    join dimensionAttribute\n    where dimensionAttribute.RecId == dimensionValue.DimensionAttribute\n{\n    info(strFmt("%1 = %2", dimensionAttribute.Name, setItem.DisplayValue));\n}',
    expect: "custTable.DefaultDimension",
  },
  {
    lesson: "11-financial-dimensions",
    task: "count-the-values",
    label: "treats every customer as having none",
    source:
      'CustTable custTable;\nint without;\nint total;\n\nwhile select custTable\n{\n    total++;\n    info(strFmt("%1 has no dimensions", custTable.AccountNum));\n    without++;\n}\n\ninfo(strFmt("%1 of %2 customers have none", without, total));',
    expect: "C-1000 does have dimensions",
  },
  {
    lesson: "11-financial-dimensions",
    task: "merge-two-sets",
    label: "lets the item's value overwrite the customer's, which is the whole trap",
    source:
      'CustTable custTable;\nInventTable inventTable;\nDimensionAttributeValueSetItem targetItem, sourceItem;\nDimensionAttributeValue targetValue, sourceValue;\nDimensionAttribute targetAttribute, sourceAttribute;\n\nselect firstonly custTable where custTable.AccountNum == "C-1000";\nselect firstonly inventTable where inventTable.ItemId == "F-100";\n\nwhile select targetItem\n    where targetItem.DimensionAttributeValueSet == custTable.DefaultDimension\n    join targetValue\n    where targetValue.RecId == targetItem.DimensionAttributeValue\n    join targetAttribute\n    where targetAttribute.RecId == targetValue.DimensionAttribute\n{\n    info(strFmt("%1 = %2", targetAttribute.Name, targetItem.DisplayValue));\n}\n\nwhile select sourceItem\n    where sourceItem.DimensionAttributeValueSet == inventTable.DefaultDimension\n    join sourceValue\n    where sourceValue.RecId == sourceItem.DimensionAttributeValue\n    join sourceAttribute\n    where sourceAttribute.RecId == sourceValue.DimensionAttribute\n{\n    info(strFmt("%1 = %2", sourceAttribute.Name, sourceItem.DisplayValue));\n}',
    expect: "the target wins, it is not last-writer-wins",
  },

  // -- 12 Integration ------------------------------------------------------
  {
    lesson: "12-integration",
    task: "denormalise",
    label: "queries the party inside the loop instead of joining",
    source:
      'CustTable custTable;\nDirPartyTable dirPartyTable;\nint counter;\n\nwhile select custTable\n{\n    select firstonly dirPartyTable where dirPartyTable.RecId == custTable.Party;\n    info(strFmt("%1 = %2", custTable.AccountNum, dirPartyTable.Name));\n    counter++;\n}\n\ninfo(strFmt("%1 customers", counter));',
    expect: "The join is what an entity saves you",
  },
  {
    lesson: "12-integration",
    task: "cross-company",
    label: "forgets crosscompany, which is the bug the step is about",
    source:
      'CustTable custTable;\nint here;\nint everywhere;\n\nwhile select custTable\n{\n    here++;\n}\n\nwhile select custTable\n{\n    everywhere++;\n}\n\ninfo(strFmt("HVND: %1", here));\ninfo(strFmt("All companies: %1", everywhere));',
    expect: "Nothing here used crosscompany",
  },
  {
    lesson: "12-integration",
    task: "validate-through-the-entity",
    label: "asks validateWrite and then writes the record anyway",
    source:
      'InventTable inventTable;\nboolean allowed;\n\nallowed = inventTable.validateWrite();\ninfo(strFmt("validateWrite says: %1", allowed));\n\nttsbegin;\ninventTable.ItemId = "X-1";\ninventTable.insert();\nttscommit;',
    expect: "validateWrite() answers the question without writing anything",
  },
  {
    lesson: "12-integration",
    task: "validate-through-the-entity",
    label: "never asks, and just states the answer it expects",
    source: 'InventTable inventTable;\n\ninfo("validateWrite says: No");',
    expect: "Call validateWrite() on the buffer",
  },

  // -- 13 Classes and methods ----------------------------------------------
  {
    lesson: "13-classes-and-methods",
    task: "hide-a-field",
    label: "logs the literal instead of reading it back through the accessor",
    source:
      'class Customer\n{\n    private str account;\n\n    public void setAccount(str _account)\n    {\n        account = _account;\n    }\n\n    public str getAccount()\n    {\n        return account;\n    }\n}\n\nCustomer customer = new Customer();\ncustomer.setAccount("C-1000");\ninfo("Account: C-1000");',
    expect: "Read the value back through getAccount()",
  },
  {
    lesson: "13-classes-and-methods",
    task: "static-counter",
    label: "makes the counter an instance field, so each object counts on its own",
    source:
      'class Tally\n{\n    public int total;\n\n    public void add(int _n)\n    {\n        total = total + _n;\n    }\n\n    public int report()\n    {\n        return total;\n    }\n}\n\nTally first = new Tally();\nTally second = new Tally();\nfirst.add(3);\nsecond.add(4);\ninfo(strFmt("Total: %1", second.report()));',
    expect: "each object counted on its own",
  },
  {
    lesson: "13-classes-and-methods",
    task: "inherit",
    label: "repeats the base class's string instead of calling super()",
    source:
      'class Animal\n{\n    public str speak()\n    {\n        return "...";\n    }\n}\n\nclass Dog extends Animal\n{\n    public str speak()\n    {\n        return "... woof";\n    }\n}\n\nDog dog = new Dog();\ninfo(dog.speak());',
    expect: "Use super() for the first half",
  },

  // -- 14 A report, end to end ---------------------------------------------
  {
    lesson: "14-report-end-to-end",
    task: "write-the-provider",
    label: "forgets the transaction around the inserts",
    source:
      'class ItemSalesDP extends SRSReportDataProviderBase\n{\n    private TmpItemSales tmpItemSales;\n\n    [SRSReportDataSetAttribute("ItemSales")]\n    public TmpItemSales getItemSales()\n    {\n        return tmpItemSales;\n    }\n\n    public void processReport()\n    {\n        SalesLine salesLine;\n        InventTable inventTable;\n        int counter;\n\n        while select salesLine\n            join inventTable\n            where inventTable.ItemId == salesLine.ItemId\n        {\n            tmpItemSales.clear();\n            tmpItemSales.ItemGroupId = inventTable.ItemGroupId;\n            tmpItemSales.ItemId = inventTable.ItemId;\n            tmpItemSales.insert();\n            counter++;\n        }\n\n        info(strFmt("Provider wrote %1 rows", counter));\n    }\n}\n\nItemSalesDP provider = new ItemSalesDP();\nprovider.processReport();',
    expect: "transaction",
  },
  {
    lesson: "14-report-end-to-end",
    task: "run-the-report",
    label: "calls the provider directly instead of letting the controller find it",
    source:
      'class ItemSalesDP extends SRSReportDataProviderBase\n{\n    private TmpItemSales tmpItemSales;\n\n    [SRSReportDataSetAttribute("ItemSales")]\n    public TmpItemSales getItemSales()\n    {\n        return tmpItemSales;\n    }\n\n    public void processReport()\n    {\n        SalesLine salesLine;\n        InventTable inventTable;\n\n        ttsbegin;\n        while select salesLine\n            join inventTable\n            where inventTable.ItemId == salesLine.ItemId\n        {\n            tmpItemSales.clear();\n            tmpItemSales.ItemGroupId = inventTable.ItemGroupId;\n            tmpItemSales.ItemId = inventTable.ItemId;\n            tmpItemSales.insert();\n        }\n        ttscommit;\n    }\n}\n\nItemSalesDP provider = new ItemSalesDP();\nprovider.processReport();',
    expect: "Nothing started the report",
  },
  {
    lesson: "14-report-end-to-end",
    task: "run-the-report",
    label: "gets the report name wrong, which is the framework's first failure",
    source:
      'class ItemSalesDP extends SRSReportDataProviderBase\n{\n    private TmpItemSales tmpItemSales;\n\n    [SRSReportDataSetAttribute("ItemSales")]\n    public TmpItemSales getItemSales()\n    {\n        return tmpItemSales;\n    }\n\n    public void processReport()\n    {\n    }\n}\n\nSrsReportRunController controller = new SrsReportRunController();\ncontroller.parmReportName("ItemSales.Report");\ncontroller.startOperation();',
    expect: "no report called 'ItemSales'",
  },

  // -- 15 Query objects ----------------------------------------------------
  {
    lesson: "15-query-objects",
    task: "build-one",
    label: "builds the query but never walks it",
    source:
      'Query query = new Query();\nQueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));\nQueryRun queryRun = new QueryRun(query);\nInventTable inventTable;\nint counter;\n\ninfo(strFmt("%1 items", counter));',
    expect: "a QueryRun does nothing until you ask it for the first row",
  },
  {
    lesson: "15-query-objects",
    task: "range-it",
    label: "leaves the cost range empty, which widens the query rather than emptying it",
    source:
      'Query query = new Query();\nQueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));\n\nQueryBuildRange groupRange = qbds.addRange(fieldNum(InventTable, ItemGroupId));\ngroupRange.value("FURNITURE");\n\nQueryBuildRange costRange = qbds.addRange(fieldNum(InventTable, StandardCost));\n\nQueryRun queryRun = new QueryRun(query);\nInventTable inventTable;\nint counter;\n\nwhile (queryRun.next())\n{\n    inventTable = queryRun.get(tableNum(InventTable));\n    info(inventTable.ItemId);\n    counter++;\n}\n\ninfo(strFmt("%1 expensive furniture items", counter));',
    expect: "an empty range filters nothing rather than everything",
  },
  {
    lesson: "15-query-objects",
    task: "read-the-view",
    label: "joins the tables by hand instead of reading the view",
    source: [
      "SalesTable salesTable;",
      "CustTable custTable;",
      "int counter;",
      "",
      "while select salesTable",
      "    join custTable",
      "    where custTable.AccountNum == salesTable.CustAccount",
      "{",
      '    info(strFmt("%1 for %2 (%3)", salesTable.SalesId, salesTable.CustAccount, custTable.CustGroup));',
      "    counter++;",
      "}",
      "",
      'info(strFmt("%1 orders", counter));',
    ].join("\n"),
    // Joining by hand gives the right answer and misses the point: the view already did
    // it, and doing it again is the habit views exist to remove.
    expect: "stops you rewriting that join",
  },
  {
    lesson: "15-query-objects",
    task: "sort-and-run",
    label: "sorts the wrong way round",
    source:
      'Query query = new Query();\nQueryBuildDataSource qbds = query.addDataSource(tableNum(InventTable));\n\nqbds.addSortField(fieldNum(InventTable, ItemId), SortOrder::Ascending);\n\nQueryRun queryRun = new QueryRun(query);\nInventTable inventTable;\nboolean first = true;\n\nwhile (queryRun.next())\n{\n    inventTable = queryRun.get(tableNum(InventTable));\n\n    if (first)\n    {\n        info(strFmt("First: %1", inventTable.ItemId));\n        first = false;\n    }\n}',
    expect: "the sort order is ascending",
  },

  // -- 16 Chain of Command -------------------------------------------------
  {
    lesson: "16-chain-of-command",
    task: "first-wrapper",
    label: "edits the original class instead of extending it",
    source: [
      "class SalesPriceService",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      "        return 110;",
      "    }",
      "}",
      "",
      "SalesPriceService service = new SalesPriceService();",
      'info(strFmt("Price: %1", service.priceFor("F-100")));',
    ].join("\n"),
    // The output is right and the approach is the one the whole lesson exists to replace.
    expect: "The wrapper has to call `next`",
  },
  {
    lesson: "16-chain-of-command",
    task: "next-is-not-optional",
    label: "leaves next inside the if, which does not build",
    source: [
      "class SalesPriceService",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      "        return 100;",
      "    }",
      "}",
      "",
      "[ExtensionOf(classStr(SalesPriceService))]",
      "final class SalesPriceService_Extension",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      '        if (_itemId == "F-100")',
      "        {",
      "            return next priceFor(_itemId) + 10;",
      "        }",
      "",
      "        return 100;",
      "    }",
      "}",
      "",
      "SalesPriceService service = new SalesPriceService();",
      'info(strFmt("F-100: %1", service.priceFor("F-100")));',
      'info(strFmt("F-101: %1", service.priceFor("F-101")));',
    ].join("\n"),
    expect: "not as a first-level statement",
  },
  {
    lesson: "16-chain-of-command",
    task: "fix-the-swallow",
    label: "leaves the swallowing wrapper in place",
    source: [
      "class SalesPriceService",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      "        return 100;",
      "    }",
      "}",
      "",
      "[ExtensionOf(classStr(SalesPriceService))]",
      "final class SalesPriceService_Surcharge",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      "        real price = next priceFor(_itemId);",
      "        return price + 10;",
      "    }",
      "}",
      "",
      "[ExtensionOf(classStr(SalesPriceService))]",
      "final class SalesPriceService_Handling",
      "{",
      "    public real priceFor(str _itemId)",
      "    {",
      "        next priceFor(_itemId);",
      "        return 5;",
      "    }",
      "}",
      "",
      "SalesPriceService service = new SalesPriceService();",
      'info(strFmt("Price: %1", service.priceFor("F-100")));',
    ].join("\n"),
    expect: "still discarding what `next` returned",
  },
];

describe("wrong answers get the message that addresses them", () => {
  it.each(
    WRONG.map((entry) => [`${entry.lesson} / ${entry.task} — ${entry.label}`, entry] as const),
  )("%s", async (_label, entry) => {
    const result = await runTask({
      task: taskFor(entry.lesson, entry.task),
      source: entry.source,
      db,
    });

    expect(result.passed, "this answer should not pass").toBe(false);
    expect(feedbackFor(result)).toContain(entry.expect);
  });

  it("covers every lesson in the track", () => {
    const covered = new Set(WRONG.map((entry) => entry.lesson));
    for (const [slug] of lessonList()) {
      expect({ lesson: slug, hasWrongAnswers: covered.has(slug) }).toEqual({
        lesson: slug,
        hasWrongAnswers: true,
      });
    }
  });
});
