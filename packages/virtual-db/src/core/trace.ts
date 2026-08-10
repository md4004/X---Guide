/**
 * The SQL trace.
 *
 * This is a headline learner-facing feature, not debug output — the whole point of
 * lesson 6 is that a learner reads their own trace and sees one UPDATE per row. So the
 * recorder keeps parameterised SQL exactly as it was executed and never inlines
 * parameter values.
 */

import type { SqlStatementKind, SqlTraceEntry, SqlValue } from "@xpplab/xpp-core";

export interface RecordOptions {
  sql: string;
  parameters?: SqlValue[];
  rowCount: number;
  transactionDepth: number;
  kind?: SqlStatementKind;
  sourceLine?: number;
}

export class SqlTrace {
  #entries: SqlTraceEntry[] = [];
  #sequence = 0;

  record(options: RecordOptions): SqlTraceEntry {
    const entry: SqlTraceEntry = {
      sequence: this.#sequence++,
      kind: options.kind ?? classify(options.sql),
      sql: options.sql,
      parameters: options.parameters ?? [],
      rowCount: options.rowCount,
      transactionDepth: options.transactionDepth,
    };
    if (options.sourceLine !== undefined) entry.sourceLine = options.sourceLine;
    this.#entries.push(entry);
    return entry;
  }

  entries(): SqlTraceEntry[] {
    return [...this.#entries];
  }

  /**
   * Clears the trace and resets numbering. Called at the start of each run so a
   * learner sees the statements from *this* run, numbered from one.
   */
  clear(): void {
    this.#entries = [];
    this.#sequence = 0;
  }
}

/** First keyword wins. The engine only ever generates these seven shapes. */
export function classify(sql: string): SqlStatementKind {
  const keyword = sql.trimStart().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  switch (keyword) {
    case "select":
      return "select";
    case "insert":
      return "insert";
    case "update":
      return "update";
    case "delete":
      return "delete";
    case "savepoint":
      return "savepoint";
    case "release":
      return "release";
    case "rollback":
      return "rollback";
    default:
      // DDL and PRAGMA are traced as selects rather than crashing the run; they are
      // invisible to learners because they only happen during init and reset.
      return "select";
  }
}
