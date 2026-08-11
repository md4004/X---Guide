/**
 * The `state`, `output` and `sql` validators.
 *
 * Each returns whether it passed plus a `detail` object. The detail is what turns
 * "wrong" into "here is what I found instead", which is the difference between a
 * learner correcting their code and a learner guessing.
 */

import type { InfologEntry, SqlTraceEntry } from "@xpplab/xpp-core";
import type { Row, VirtualDb } from "@xpplab/virtual-db";
import type { OutputValidator, SqlValidator, StateValidator } from "./types";

export interface AssertionResult {
  passed: boolean;
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export async function evaluateState(
  validator: StateValidator,
  db: VirtualDb,
): Promise<AssertionResult> {
  const rows = await db.readRows(validator.table, {
    ...(validator.company === undefined ? {} : { company: validator.company }),
  });

  const matching = rows.filter((row) => matchesWhere(row, validator.where));

  if (validator.count !== undefined) {
    return {
      passed: matching.length === validator.count,
      detail: { expectedRows: validator.count, actualRows: matching.length },
    };
  }

  const expect = validator.expect!;
  // `all` defaults to true: the stricter reading is nearly always the intended one, and
  // a task that means "at least one" can say so.
  const requireAll = validator.all ?? true;

  const satisfying = matching.filter((row) => matchesWhere(row, expect));

  if (matching.length === 0) {
    // No rows matched the `where` at all. That is a different failure from "rows matched
    // but held the wrong values", and saying which is most of the diagnostic value.
    return {
      passed: false,
      detail: {
        reason: "no rows matched",
        table: validator.table,
        where: validator.where ?? {},
        rowsInTable: rows.length,
      },
    };
  }

  const passed = requireAll ? satisfying.length === matching.length : satisfying.length > 0;

  return {
    passed,
    detail: {
      table: validator.table,
      matchedRows: matching.length,
      satisfyingRows: satisfying.length,
      expected: expect,
      // A sample of what actually failed, so the author can see it in the debug view.
      firstMismatch: matching.find((row) => !matchesWhere(row, expect)) ?? null,
    },
  };
}

/**
 * Field comparison.
 *
 * Loose on purpose: SQLite hands back `1` where the lesson wrote `NoYes::Yes`, and a
 * strict `===` would make every enum assertion fail for a reason the author cannot see.
 */
function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (where === undefined) return true;

  return Object.entries(where).every(([field, expected]) => {
    const actual = findField(row, field);
    if (actual === undefined) return false;
    if (actual === expected) return true;
    if (typeof expected === "boolean") return Number(actual) === (expected ? 1 : 0);
    return String(actual) === String(expected);
  });
}

/** Field names are case-insensitive, as X++ identifiers are. */
function findField(row: Row, field: string): Row[string] | undefined {
  if (field in row) return row[field];
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === field.toLowerCase());
  return key === undefined ? undefined : row[key];
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export function evaluateOutput(
  validator: OutputValidator,
  infolog: InfologEntry[],
): AssertionResult {
  const candidates =
    validator.type === undefined
      ? infolog
      : infolog.filter((entry) => entry.type === validator.type);

  let pattern: RegExp;
  try {
    pattern = new RegExp(validator.match);
  } catch {
    // A broken regex is an authoring bug. Fail loudly rather than silently never
    // matching, which would look like the learner's fault.
    return {
      passed: false,
      detail: { authoringError: `The pattern ${validator.match} is not a valid regex.` },
    };
  }

  const matched = candidates.some((entry) => pattern.test(entry.message));
  const passed = validator.negate === true ? !matched : matched;

  return {
    passed,
    detail: {
      pattern: validator.match,
      type: validator.type ?? "any",
      negate: validator.negate ?? false,
      messagesSeen: candidates.map((entry) => entry.message),
    },
  };
}

// ---------------------------------------------------------------------------
// sql
// ---------------------------------------------------------------------------

/**
 * Savepoints are not data operations, and counting them would make `maxStatements`
 * depend on how a learner nested their transactions rather than on how many times they
 * hit the database.
 */
const BOOKKEEPING = new Set(["savepoint", "release", "rollback"]);

export function evaluateSql(validator: SqlValidator, trace: SqlTraceEntry[]): AssertionResult {
  const statements = trace.filter((entry) => !BOOKKEEPING.has(entry.kind));

  switch (validator.rule) {
    case "maxStatements":
      return {
        passed: statements.length <= validator.value,
        detail: {
          limit: validator.value,
          actual: statements.length,
          statements: statements.map((entry) => `${entry.kind} (${entry.rowCount} rows)`),
        },
      };

    case "minStatements":
      return {
        passed: statements.length >= validator.value,
        detail: { minimum: validator.value, actual: statements.length },
      };

    case "matches":
    case "forbids": {
      let pattern: RegExp;
      try {
        pattern = new RegExp(validator.value, "i");
      } catch {
        return {
          passed: false,
          detail: { authoringError: `The pattern ${validator.value} is not a valid regex.` },
        };
      }
      const found = statements.some((entry) => pattern.test(entry.sql));
      return {
        passed: validator.rule === "matches" ? found : !found,
        detail: {
          pattern: validator.value,
          found,
          sql: statements.map((entry) => entry.sql),
        },
      };
    }
  }
}
