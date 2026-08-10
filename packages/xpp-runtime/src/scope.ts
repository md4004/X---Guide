/**
 * The scope chain.
 *
 * X++ identifiers are case-insensitive, so lookups are keyed on the lowercased name
 * while the original casing is kept for error messages. A learner who declares
 * `custTable` and then writes `CustTable.AccountNum` should not get a "not declared"
 * error, because the real compiler would not give them one.
 */

import type { XppValue } from "./values.js";

interface Binding {
  /** The name as it was written, for diagnostics. */
  declaredAs: string;
  value: XppValue;
  /** The declared type name, which the buffer machinery needs after the fact. */
  typeName: string;
}

export class Scope {
  readonly #bindings = new Map<string, Binding>();
  readonly parent: Scope | undefined;

  constructor(parent?: Scope) {
    this.parent = parent;
  }

  /** Opens a nested scope — a block, a loop body, a method body. */
  child(): Scope {
    return new Scope(this);
  }

  declare(name: string, value: XppValue, typeName = ""): void {
    this.#bindings.set(name.toLowerCase(), { declaredAs: name, value, typeName });
  }

  get(name: string): XppValue | undefined {
    return this.#find(name)?.value;
  }

  typeOf(name: string): string | undefined {
    return this.#find(name)?.typeName;
  }

  has(name: string): boolean {
    return this.#find(name) !== undefined;
  }

  /**
   * Assigns to an existing binding, wherever in the chain it lives. Returns false if
   * the name was never declared — X++ has no implicit declaration, and saying so is
   * more useful than silently creating a variable.
   */
  set(name: string, value: XppValue): boolean {
    const binding = this.#find(name);
    if (binding === undefined) return false;
    binding.value = value;
    return true;
  }

  /**
   * Every name visible from here, innermost first. For the "did you mean" hint.
   *
   * Recursive rather than a loop: scope chains are a handful of levels deep at most, and
   * walking the parent link by recursion reads better than a cursor variable.
   */
  visibleNames(): string[] {
    const own = [...this.#bindings.values()].map((binding) => binding.declaredAs);
    return this.parent === undefined ? own : [...own, ...this.parent.visibleNames()];
  }

  #find(name: string): Binding | undefined {
    const own = this.#bindings.get(name.toLowerCase());
    if (own !== undefined) return own;
    // Not an optional chain: TypeScript does not allow `?.` before a private name.
    return this.parent === undefined ? undefined : this.parent.#find(name);
  }
}

/**
 * The closest visible name to `name`, for a "did you mean" hint.
 *
 * Plain edit distance, capped so it only fires on a genuine near-miss. Suggesting
 * something wildly different is worse than suggesting nothing.
 */
export function closestName(name: string, candidates: string[]): string | undefined {
  const target = name.toLowerCase();
  let best: { name: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (distance === 0) continue;
    if (best === undefined || distance < best.distance) best = { name: candidate, distance };
  }

  const threshold = Math.max(2, Math.floor(name.length / 3));
  return best !== undefined && best.distance <= threshold ? best.name : undefined;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);

  for (let row = 1; row < rows; row++) {
    const current = [row, ...new Array<number>(columns - 1).fill(0)];
    for (let column = 1; column < columns; column++) {
      const substitution = previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
    }
    previous = current;
  }

  return previous[columns - 1]!;
}
