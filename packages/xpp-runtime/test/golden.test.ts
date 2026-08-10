/**
 * The golden-file suite — Phase 3's acceptance criterion.
 *
 * Each case in fixtures/cases.xpp runs against a freshly seeded database. Three things
 * are recorded and committed as a golden file: the Infolog, the SQL trace, and the
 * resulting database state plus any errors.
 *
 * The SQL trace is in the golden file deliberately. It is a user-visible feature, so a
 * change to the SQL a `while select` generates should show up as a reviewable diff, not
 * slip through because the row counts still matched.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createVirtualDb, type Snapshot, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "../src/index.js";

interface Case {
  name: string;
  source: string;
}

function loadCases(): Case[] {
  const text = readFileSync(
    fileURLToPath(new URL("../fixtures/cases.xpp", import.meta.url)),
    "utf8",
  );
  const cases: Case[] = [];
  let current: { name: string; body: string[] } | undefined;

  for (const line of text.split(/\r?\n/)) {
    const marker = /^\/\/== (.+)$/.exec(line);
    if (marker) {
      if (current) cases.push(finish(current));
      current = { name: marker[1]!.trim(), body: [] };
      continue;
    }
    current?.body.push(line);
  }
  if (current) cases.push(finish(current));
  return cases;
}

function finish(current: { name: string; body: string[] }): Case {
  const body = [...current.body];
  while (body.length > 0 && body.at(-1)!.trim() === "") body.pop();
  return { name: current.name, source: body.join("\n") };
}

const cases = loadCases();

/** Tables a case may plausibly touch. Kept short so goldens stay readable. */
const WATCHED = ["CustTable", "InventTable", "SalesTable"] as const;

let db: VirtualDb;
let pristine: Snapshot;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
  pristine = await db.snapshot();
});

afterEach(async () => {
  await db.close();
});

/**
 * Renders a case's outcome as the golden text.
 *
 * Row counts and changed rows rather than whole tables: a full dump would be thousands
 * of lines and nobody would review it, which defeats the point of a golden file.
 */
async function render(name: string, source: string): Promise<string> {
  const before = new Map<string, number>();
  for (const table of WATCHED) {
    before.set(table, (await db.readRows(table, { company: "all" })).length);
  }

  const result = await runSource({ source, db, today: "2026-08-10" });

  const lines: string[] = [`# ${name}`, "", "## Infolog"];
  lines.push(
    result.infolog.length === 0
      ? "(empty)"
      : result.infolog.map((entry) => `${entry.type}: ${entry.message}`).join("\n"),
  );

  lines.push("", "## SQL trace");
  lines.push(
    result.sqlTrace.length === 0
      ? "(none)"
      : result.sqlTrace
          .map((entry) => {
            const parameters =
              entry.parameters.length === 0 ? "" : `  -- ${JSON.stringify(entry.parameters)}`;
            return `[${entry.kind} rows=${entry.rowCount} tts=${entry.transactionDepth}] ${entry.sql}${parameters}`;
          })
          .join("\n"),
  );

  lines.push("", "## Errors");
  lines.push(
    result.errors.length === 0
      ? "(none)"
      : result.errors
          .map(
            (error) =>
              `${error.code} line ${error.line}: ${error.message}\n  hint: ${error.hint ?? "(none)"}`,
          )
          .join("\n"),
  );

  lines.push("", "## Database");
  const changes: string[] = [];
  for (const table of WATCHED) {
    const after = (await db.readRows(table, { company: "all" })).length;
    const delta = after - before.get(table)!;
    if (delta !== 0) changes.push(`${table}: ${delta > 0 ? "+" : ""}${delta} rows`);
  }
  lines.push(changes.length === 0 ? "(no row-count change)" : changes.join("\n"));
  lines.push(
    `statements executed: ${result.statementsExecuted}`,
    `uncommitted transaction depth: ${result.uncommittedTransactionDepth}`,
  );

  return `${lines.join("\n")}\n`;
}

describe("golden cases", () => {
  it("has at least 30 cases, as Phase 3 requires", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  it("gives every case a unique name", () => {
    const names = cases.map((testCase) => testCase.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    async (name, testCase) => {
      const rendered = await render(name, testCase.source);
      await expect(rendered).toMatchFileSnapshot(
        fileURLToPath(new URL(`../fixtures/expected/${name}.md`, import.meta.url)),
      );
      // Every case starts from the same state, so ordering never matters.
      await db.restore(pristine);
    },
  );
});
