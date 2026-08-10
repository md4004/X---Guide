/**
 * The worker request handler.
 *
 * This is the code the Web Worker runs. `worker.ts` adds nothing but postMessage
 * wiring, so testing the handler here in Node covers the shipped behaviour without
 * needing a browser.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createRequestHandler } from "../src/index.js";
import type { RequestHandler } from "../src/index.js";
import type { TransactionState } from "../src/core/transactions.js";
import type { Row } from "../src/core/database.js";

let handler: RequestHandler;

beforeEach(async () => {
  handler = await createRequestHandler();
});

const unwrap = async <T>(result: Promise<{ ok: boolean; value?: unknown; error?: string }>) => {
  const settled = await result;
  if (!settled.ok) throw new Error(settled.error);
  return settled.value as T;
};

describe("request handler", () => {
  it("answers every operation in the protocol", async () => {
    expect(await unwrap<string[]>(handler.handle({ op: "listCompanies" }))).toEqual([
      "HVND",
      "KELT",
      "MRDA",
    ]);
    expect(await unwrap<string[]>(handler.handle({ op: "listTables" }))).toContain("CustTable");

    const rows = await unwrap<Row[]>(
      handler.handle({ op: "readRows", table: "CustTable", options: {} }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("turns a thrown error into a failure result rather than rejecting", async () => {
    // The worker boundary cannot carry an Error, so failures come back as data.
    const result = await handler.handle({ op: "commitTransaction" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no open transaction/i);
  });

  it("keeps serving requests after a failure", async () => {
    await handler.handle({ op: "abortTransaction" });
    const state = await unwrap<TransactionState>(handler.handle({ op: "beginTransaction" }));
    expect(state.depth).toBe(1);
  });

  it("returns only the trace entries that this request produced", async () => {
    const first = await handler.handle({ op: "beginTransaction" });
    const second = await handler.handle({ op: "beginTransaction" });

    expect(first.ok && first.trace).toHaveLength(1);
    expect(second.ok && second.trace).toHaveLength(1);
    expect(second.ok && second.trace[0]?.sql).toBe("SAVEPOINT tts_2");
  });

  it("reports no trace for an operation that runs no SQL", async () => {
    const result = await handler.handle({ op: "listTables" });
    expect(result.ok && result.trace).toEqual([]);
  });

  it("does not leak the seeding statements into the first request's trace", async () => {
    const result = await handler.handle({ op: "getTransactionState" });
    expect(result.ok && result.trace).toEqual([]);
  });

  it("round-trips a snapshot through the protocol", async () => {
    const snapshot = await unwrap<{ seed: string; bytes: Uint8Array }>(
      handler.handle({ op: "snapshot" }),
    );
    expect(snapshot.seed).toBe("default");

    await handler.handle({
      op: "exec",
      sql: "DELETE FROM CustTable",
      parameters: [],
    });
    expect(
      await unwrap<Row[]>(handler.handle({ op: "readRows", table: "CustTable", options: {} })),
    ).toEqual([]);

    await handler.handle({ op: "restore", snapshot: snapshot as never });
    expect(
      (await unwrap<Row[]>(handler.handle({ op: "readRows", table: "CustTable", options: {} })))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("trace content", () => {
  it("records parameterised SQL without inlining the values", async () => {
    const result = await handler.handle({
      op: "exec",
      sql: "SELECT ItemId FROM InventTable WHERE ItemGroupId = ? AND DATAAREAID = ?",
      parameters: ["FURNITURE", "HVND"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = result.trace[0]!;
    expect(entry.sql).toContain("?");
    expect(entry.sql).not.toContain("FURNITURE");
    expect(entry.parameters).toEqual(["FURNITURE", "HVND"]);
    expect(entry.kind).toBe("select");
    expect(entry.rowCount).toBe(4);
  });

  it("counts rows affected by a write", async () => {
    const result = await handler.handle({
      op: "exec",
      sql: "UPDATE InventTable SET Blocked = 1 WHERE ItemGroupId = ? AND DATAAREAID = ?",
      parameters: ["FURNITURE", "HVND"],
    });

    expect(result.ok && result.trace[0]?.kind).toBe("update");
    expect(result.ok && result.trace[0]?.rowCount).toBe(4);
  });

  it("numbers entries from zero after a clear", async () => {
    const a = await handler.handle({ op: "exec", sql: "SELECT 1", parameters: [] });
    const b = await handler.handle({ op: "exec", sql: "SELECT 1", parameters: [] });

    // Each response is drained independently, so both start at zero and the client
    // is what gives them a running order.
    expect(a.ok && a.trace[0]?.sequence).toBe(0);
    expect(b.ok && b.trace[0]?.sequence).toBe(0);
  });
});
