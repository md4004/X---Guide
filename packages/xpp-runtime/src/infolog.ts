/**
 * The Infolog sink.
 *
 * One method here exists purely because of VB-009: `retry` erases every message written
 * since control entered the `try` block. That is startling behaviour, it is documented,
 * and a simulator that quietly kept the messages would be teaching the wrong thing — so
 * the Infolog supports marking a position and truncating back to it.
 */

import type { InfologEntry, InfologType } from "@xpplab/xpp-core";

export interface Infolog {
  add(type: InfologType, message: string, line?: number): void;
  entries(): readonly InfologEntry[];
  clear(): void;
  /** How many entries exist right now — the mark a `retry` rewinds to. */
  mark(): number;
  /** Discards everything written after `mark`. VB-009. */
  rewindTo(mark: number): void;
}

class InfologImpl implements Infolog {
  #entries: InfologEntry[] = [];

  add(type: InfologType, message: string, line?: number): void {
    this.#entries.push({
      type,
      message,
      sequence: this.#entries.length,
      ...(line === undefined ? {} : { line }),
    });
  }

  entries(): readonly InfologEntry[] {
    return this.#entries;
  }

  clear(): void {
    this.#entries = [];
  }

  mark(): number {
    return this.#entries.length;
  }

  rewindTo(mark: number): void {
    this.#entries = this.#entries.slice(0, mark);
    // Sequence numbers stay contiguous, or the UI renders gaps.
    this.#entries = this.#entries.map((entry, index) => ({ ...entry, sequence: index }));
  }
}

export function createInfolog(): Infolog {
  return new InfologImpl();
}
