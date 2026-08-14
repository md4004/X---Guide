/**
 * Walking the conversation, and what the learner ends up knowing.
 *
 * Pure state so the reply logic can be tested without a browser: the UI holds a
 * `BriefState` and calls `reply` / `advance`, and never decides anything itself.
 *
 * The design rule here is that **no choice is a dead end**. A scenario is a rehearsal for
 * a conversation the learner will really have, and the cost of not asking the right
 * question on a real project is not that you are stopped — it is that you build the wrong
 * thing and find out later. So a weak reply advances, and the requirement it failed to
 * pin stays vague until `closeBrief` reveals it with the fact that nobody asked.
 */

import type { Requirement, ScenarioDefinition } from "./types";

export interface BriefState {
  /** Index of the next turn to reveal. */
  turn: number;
  /** Requirement ids the learner pinned down by asking. */
  pinned: string[];
  /** Choice ids taken, in order, for the summary at the end. */
  choices: string[];
  /** Set by `closeBrief`: the conversation is over and everything is revealed. */
  closed: boolean;
}

export function createBriefState(): BriefState {
  return { turn: 0, pinned: [], choices: [], closed: false };
}

/** The turns to show right now — everything up to and including the current one. */
export function visibleTurns(scenario: ScenarioDefinition, state: BriefState): number {
  return Math.min(state.turn + 1, scenario.conversation.length);
}

/** Whether the conversation is waiting on the learner rather than on the Next button. */
export function awaitingReply(scenario: ScenarioDefinition, state: BriefState): boolean {
  if (state.closed) return false;
  const turn = scenario.conversation[state.turn];
  return turn?.choices !== undefined && !state.choices.some((id) => hasChoice(turn.choices!, id));
}

const hasChoice = (choices: { id: string }[], id: string): boolean =>
  choices.some((choice) => choice.id === id);

export function reply(
  scenario: ScenarioDefinition,
  state: BriefState,
  choiceId: string,
): BriefState {
  const turn = scenario.conversation[state.turn];
  const choice = turn?.choices?.find((candidate) => candidate.id === choiceId);
  if (choice === undefined) return state;

  return {
    ...state,
    choices: [...state.choices, choice.id],
    pinned: [...new Set([...state.pinned, ...(choice.pins ?? [])])],
  };
}

export function advance(scenario: ScenarioDefinition, state: BriefState): BriefState {
  if (awaitingReply(scenario, state)) return state;
  if (state.turn >= scenario.conversation.length - 1) return { ...state, closed: true };
  return { ...state, turn: state.turn + 1 };
}

export function isBriefComplete(state: BriefState): boolean {
  return state.closed;
}

/**
 * The requirement list as the learner should now see it.
 *
 * `known` is true when they asked and got the detail in the conversation. Once the brief
 * is closed everything is known — you always find out, the only question is whether it
 * was before or after you wrote the code.
 */
export interface KnownRequirement extends Requirement {
  known: boolean;
  /** True when the detail only surfaced because the brief ended, not because they asked. */
  learnedLate: boolean;
}

export function requirementsFor(
  scenario: ScenarioDefinition,
  state: BriefState,
): KnownRequirement[] {
  // Only a requirement some reply could have pinned can be "learned late". Reproaching
  // somebody for not asking a question the conversation never offered is both untrue and
  // the fastest way to make them stop reading the panel.
  const askable = new Set(
    scenario.conversation.flatMap((turn) =>
      (turn.choices ?? []).flatMap((choice) => choice.pins ?? []),
    ),
  );

  return scenario.requirements.map((requirement) => {
    const asked = state.pinned.includes(requirement.id);
    return {
      ...requirement,
      known: asked || state.closed,
      learnedLate: !asked && state.closed && askable.has(requirement.id),
    };
  });
}
