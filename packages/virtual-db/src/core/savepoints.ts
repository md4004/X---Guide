/**
 * The raw SQLite savepoint stack.
 *
 * This layer knows nothing about X++. It opens, releases and rolls back to savepoints,
 * and tracks how deep it is. Rolling back to level N here discards work done at level N
 * and deeper, leaving shallower work intact — standard savepoint behaviour.
 *
 * X++ semantics are built on top of this in `transactions.ts`, and they are NOT the
 * same: `ttsabort` discards everything from any depth (VB-001). Keeping the two apart
 * means each can be tested for what it actually does.
 */

import type { SqliteHandle } from "./sqlite";

/** Called for each statement so the caller can record it in the learner-visible trace. */
export type SavepointObserver = (
  kind: "savepoint" | "release" | "rollback",
  sql: string,
  depthAfter: number,
) => void;

export class SavepointStack {
  readonly #sqlite: SqliteHandle;
  readonly #observer: SavepointObserver | undefined;
  #depth = 0;

  constructor(sqlite: SqliteHandle, observer?: SavepointObserver) {
    this.#sqlite = sqlite;
    this.#observer = observer;
  }

  get depth(): number {
    return this.#depth;
  }

  /** Open savepoint names, outermost first. */
  get savepoints(): string[] {
    return Array.from({ length: this.#depth }, (_, i) => nameFor(i + 1));
  }

  /** Opens a savepoint one level deeper and returns the new depth. */
  begin(): number {
    this.#depth += 1;
    const sql = `SAVEPOINT ${nameFor(this.#depth)}`;
    this.#sqlite.run(sql);
    this.#observer?.("savepoint", sql, this.#depth);
    return this.#depth;
  }

  /** Releases the innermost savepoint and returns the new depth. */
  release(): number {
    if (this.#depth === 0) {
      throw new Error("Cannot release: there is no open savepoint.");
    }
    const sql = `RELEASE SAVEPOINT ${nameFor(this.#depth)}`;
    this.#sqlite.run(sql);
    this.#depth -= 1;
    this.#observer?.("release", sql, this.#depth);
    return this.#depth;
  }

  /**
   * Rolls back to `level` and discards it, so the resulting depth is `level - 1`.
   *
   * SQLite's `ROLLBACK TO` leaves the savepoint open; we release it straight after so
   * the depth counter and the database agree.
   */
  rollbackTo(level: number): number {
    if (level < 1 || level > this.#depth) {
      throw new Error(
        `Cannot roll back to level ${level}: the current savepoint depth is ${this.#depth}.`,
      );
    }
    const name = nameFor(level);
    const sql = `ROLLBACK TO SAVEPOINT ${name}`;
    this.#sqlite.run(sql);
    this.#sqlite.run(`RELEASE SAVEPOINT ${name}`);
    this.#depth = level - 1;
    this.#observer?.("rollback", sql, this.#depth);
    return this.#depth;
  }

  /**
   * Drops every open savepoint without rolling back. Used after a snapshot restore,
   * where the database has been replaced wholesale and the old stack is meaningless.
   */
  reset(): void {
    this.#depth = 0;
  }
}

function nameFor(level: number): string {
  return `tts_${level}`;
}
