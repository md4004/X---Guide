/**
 * Behaviours whose expected output Microsoft publishes.
 *
 * These assert against the exact Infolog text printed in the X++ exception-handling
 * reference. They are the strongest tests in the engine: the expectation is not our
 * opinion of what should happen, it is the documented output of a real AOS.
 *
 * They duplicate three golden files on purpose. A snapshot diff is easy to accept
 * without reading; an assertion with the source quoted next to it is not. One of these
 * caught a real inversion in the VB-008 logic that the golden file alone would have
 * happily recorded as correct.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "../src/index.js";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const messagesOf = async (source: string): Promise<string[]> => {
  const result = await runSource({ source, db, today: "2026-08-10" });
  return result.infolog.map((entry) => entry.message);
};

describe("VB-008: an exception inside a transaction skips the catch inside it", () => {
  /**
   * Microsoft's `TryCatchTransaction5Job`. Their published Infolog output:
   *
   *   Throwing exception inside transaction.
   *   Catch_2: Expected, caught in the innermost 'catch' that is outside of the transaction block.
   *   End of job.
   *
   * Catch_1 and Catch_3 are both labelled "Unexpected" in the source, and neither runs.
   */
  it("matches the published Infolog exactly", async () => {
    const messages = await messagesOf(`
try
{
    try
    {
        ttsbegin;
        try
        {
            throw error("Throwing exception inside transaction.");
        }
        catch (Exception::Error)
        {
            info("Catch_1: Unexpected, caught in 'catch' inside the transaction block.");
        }
        ttscommit;
    }
    catch (Exception::Error)
    {
        info("Catch_2: Expected, caught in the innermost 'catch' that is outside of the transaction block.");
    }
}
catch (Exception::Error)
{
    info("Catch_3: Unexpected, caught in 'catch' far outside the transaction block.");
}
info("End of job.");
`);

    expect(messages).toEqual([
      "Throwing exception inside transaction.",
      "Catch_2: Expected, caught in the innermost 'catch' that is outside of the transaction block.",
      "End of job.",
    ]);
  });

  it("still catches normally when there is no transaction", async () => {
    const messages = await messagesOf(`
try
{
    throw error("plain failure");
}
catch (Exception::Error)
{
    info("caught");
}
`);
    expect(messages).toEqual(["plain failure", "caught"]);
  });

  it("lets the catch run when the try wraps the ttsbegin", async () => {
    // The catch is outside the transaction block here, so it is eligible.
    const messages = await messagesOf(`
try
{
    ttsbegin;
    throw error("inside, but the try is outside");
    ttscommit;
}
catch (Exception::Error)
{
    info("caught");
}
`);
    expect(messages).toEqual(["inside, but the try is outside", "caught"]);
  });

  it("makes the carve-out real: DuplicateKeyException IS catchable inside a transaction", async () => {
    // The documented exceptions to VB-008 are UpdateConflict and DuplicateKeyException.
    const messages = await messagesOf(`
CustTable custTable;
ttsbegin;
try
{
    custTable.AccountNum = "C-1000";
    custTable.insert();
}
catch (Exception::DuplicateKeyException)
{
    info("caught the duplicate from inside the transaction");
}
`);
    expect(messages).toEqual(["caught the duplicate from inside the transaction"]);
  });
});

describe("VB-010: error() logs, throw does not", () => {
  /**
   * Microsoft's `TryCatchThrowError1Job` and `TryCatchGlobalError2Job`. Published output:
   *
   *   In the 'try' block. (j1)
   *   Caught 'Exception::Error'.
   *
   *   In the 'try' block. (j2)
   *   Written to the Infolog.
   *   Caught 'Exception::Error'.
   */
  it("writes nothing for a bare throw of the enum value", async () => {
    const messages = await messagesOf(`
try
{
    info("In the 'try' block. (j1)");
    throw Exception::Error;
}
catch (Exception::Error)
{
    info("Caught 'Exception::Error'.");
}
`);
    expect(messages).toEqual(["In the 'try' block. (j1)", "Caught 'Exception::Error'."]);
  });

  it("writes the text when the throw goes through error()", async () => {
    const messages = await messagesOf(`
try
{
    info("In the 'try' block. (j2)");
    throw error("Written to the Infolog.");
}
catch (Exception::Error)
{
    info("Caught 'Exception::Error'.");
}
`);
    expect(messages).toEqual([
      "In the 'try' block. (j2)",
      "Written to the Infolog.",
      "Caught 'Exception::Error'.",
    ]);
  });
});

describe("VB-009: retry erases the Infolog back to the try", () => {
  it("keeps only the successful attempt's messages", async () => {
    const messages = await messagesOf(`
int attempts;
try
{
    info(strFmt("attempt %1", attempts));
    attempts++;
    if (attempts < 3)
    {
        throw error("not yet");
    }
    info("succeeded");
}
catch (Exception::Error)
{
    retry;
}
info("End of job.");
`);

    // The first two attempts logged, then were erased. Only the third survives.
    expect(messages).toEqual(["attempt 2", "succeeded", "End of job."]);
  });
});

describe("VB-001: ttsabort discards everything, from any depth", () => {
  it("rolls back work done at the outer level too", async () => {
    const before = (await db.readRows("CustTable")).length;

    await runSource({
      source: `
CustTable custTable;
ttsbegin;
custTable.AccountNum = "C-OUTER";
custTable.insert();
ttsbegin;
custTable.clear();
custTable.AccountNum = "C-INNER";
custTable.insert();
ttsabort;
`,
      db,
    });

    expect((await db.readRows("CustTable")).length).toBe(before);
  });
});

describe("VB-003 and VB-004: the forUpdate and ttsLevel checks", () => {
  it("refuses to update a buffer that was not selected for update", async () => {
    const result = await runSource({
      source: `
InventTable inventTable;
ttsbegin;
select inventTable where inventTable.ItemId == "F-100";
inventTable.ItemName = "Renamed";
inventTable.update();
ttscommit;
`,
      db,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain("not selected for update");
    expect(result.errors[0]?.hint).toContain("forupdate");
  });

  it("refuses to update across transaction scopes", async () => {
    const result = await runSource({
      source: `
InventTable inventTable;
ttsbegin;
select forupdate inventTable where inventTable.ItemId == "F-100";
ttscommit;

ttsbegin;
inventTable.ItemName = "Renamed";
inventTable.update();
ttscommit;
`,
      db,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain("different transaction scope");
  });

  it("refuses to write outside a transaction at all", async () => {
    const result = await runSource({
      source: `
CustTable custTable;
custTable.AccountNum = "C-8888";
custTable.insert();
`,
      db,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain("outside a transaction scope");
  });
});
