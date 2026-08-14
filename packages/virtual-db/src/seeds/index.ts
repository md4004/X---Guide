import { creditSeed } from "./credit";
import { defaultSeed } from "./default";
import type { SeedDefinition, SeedName } from "./types";

export type { SeedDefinition, SeedName } from "./types";
export { creditSeed } from "./credit";
export { defaultSeed } from "./default";

/**
 * Schema, no rows. For lessons that teach "what happens when the select finds nothing",
 * which is otherwise awkward to set up against a populated dataset.
 */
export const emptySeed: SeedDefinition = {
  name: "empty",
  description: "The full schema with no rows in any table.",
  rows: {},
};

export const SEEDS: Readonly<Record<string, SeedDefinition>> = {
  default: defaultSeed,
  empty: emptySeed,
  credit: creditSeed,
};

export function getSeed(name: SeedName): SeedDefinition {
  const seed = SEEDS[name];
  if (seed === undefined) {
    throw new Error(
      `Unknown seed "${name}". Available seeds: ${Object.keys(SEEDS).sort().join(", ")}.`,
    );
  }
  return seed;
}
