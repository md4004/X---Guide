/**
 * The scenario registry.
 *
 * Plain TypeScript rather than MDX. A lesson is mostly prose with a task at the end, so
 * MDX earns its place there; a scenario is mostly *data* — a conversation, a requirement
 * list, a set of acceptance checks — and authoring that as a component would put the
 * validators behind a compile step for no gain.
 */

import type { ScenarioDefinition } from "@xpplab/scenarios";
import { creditHold } from "./credit-hold";

export const scenarios: Record<string, ScenarioDefinition> = {
  [creditHold.slug]: creditHold,
};

export const orderedScenarioSlugs: string[] = [creditHold.slug];

export function getScenario(slug: string): ScenarioDefinition | undefined {
  return scenarios[slug];
}
