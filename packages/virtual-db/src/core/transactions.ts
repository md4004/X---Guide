/**
 * X++ transaction semantics.
 *
 * `ttsbegin` and `ttscommit` map onto the savepoint stack one-for-one, so nesting depth
 * is real and nothing is durable until the outermost commit (VB-002).
 *
 * `ttsabort` does not. In X++ it "explicitly discards all changes in the current
 * transaction … the database is rolled back to the original state" — from any depth,
 * leaving ttsLevel at 0 (VB-001). That is a rollback to the *outermost* savepoint, not
 * to the innermost one, and it is the single most important difference between this
 * class and the savepoint stack underneath it.
 *
 * Sources for both are logged in docs/verified-behaviour.md.
 */

import type { SavepointStack } from "./savepoints";

export interface TransactionState {
  depth: number;
  /** Savepoint names, outermost first. */
  savepoints: string[];
}

export class TransactionManager {
  readonly #savepoints: SavepointStack;

  constructor(savepoints: SavepointStack) {
    this.#savepoints = savepoints;
  }

  /** `ttsLevel`. Zero means no transaction is open. */
  get depth(): number {
    return this.#savepoints.depth;
  }

  get state(): TransactionState {
    return { depth: this.#savepoints.depth, savepoints: this.#savepoints.savepoints };
  }

  /** `ttsbegin` */
  begin(): TransactionState {
    this.#savepoints.begin();
    return this.state;
  }

  /**
   * `ttscommit`
   *
   * Releasing the innermost savepoint. Only the outermost release makes the work
   * durable, which is what VB-002 describes.
   */
  commit(): TransactionState {
    if (this.#savepoints.depth === 0) {
      throw new Error("ttscommit without a matching ttsbegin: there is no open transaction.");
    }
    this.#savepoints.release();
    return this.state;
  }

  /**
   * `ttsabort`
   *
   * VB-001: discards the whole transaction regardless of the depth this was called at.
   * Rolling back only one level would be the savepoint reading, and it would be wrong.
   */
  abort(): TransactionState {
    if (this.#savepoints.depth === 0) {
      throw new Error("ttsabort without a matching ttsbegin: there is no open transaction.");
    }
    this.#savepoints.rollbackTo(1);
    return this.state;
  }

  /** Forgets any open transaction without rolling back. For snapshot restores. */
  reset(): void {
    this.#savepoints.reset();
  }
}
