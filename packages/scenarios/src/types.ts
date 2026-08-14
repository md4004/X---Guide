/**
 * What a scenario is.
 *
 * A lesson teaches one construct. A scenario is a *job*: somebody asks you for something
 * in their own words, you work out what they actually need, you build it, you prove it
 * works, and then you get it into production — which in Finance and Operations is a
 * gated process rather than a button.
 *
 * The four phases mirror that, and the learner cannot skip one:
 *
 *   brief → build → test → release
 *
 * Only `release` is a simulation of a documented external system (VB-070 to VB-081).
 * `build` and `test` run the same engine and the same validators as every lesson, so a
 * scenario cannot assert anything a lesson could not.
 */

import type { TaskDefinition, Validator } from "@xpplab/validators";

export type ScenarioPhase = "brief" | "build" | "test" | "release";

export const PHASE_ORDER: ScenarioPhase[] = ["brief", "build", "test", "release"];

/** Somebody in the conversation. */
export interface Speaker {
  /** Key used by turns. */
  id: string;
  name: string;
  /** Shown under the name on the first bubble of a run of theirs. */
  role: string;
  /** Two letters for the avatar. */
  initials: string;
}

/**
 * One thing the learner can say back.
 *
 * A scenario is not a quiz, so every choice advances the conversation. What differs is
 * what you learn: `pins` names the requirements this reply nailed down. A reply that pins
 * nothing is not punished with a dead end — it is punished the way it is on a real
 * project, by the requirement staying vague until it bites you in `build`.
 */
export interface ReplyChoice {
  id: string;
  /** What the learner says. */
  text: string;
  /** What the consultant says back. */
  response: string;
  /** Requirement ids this reply establishes. */
  pins?: string[];
  /**
   * Shown after the reply, in the margin — why this was or was not the question worth
   * asking. Authored for every choice, including the good one.
   */
  note: string;
}

export interface ConversationTurn {
  /** A speaker id from the cast, or `"you"`. */
  speaker: string;
  text: string;
  /** Present on a turn that hands the floor to the learner. */
  choices?: ReplyChoice[];
}

/**
 * One line of the spec, in the functional consultant's words rather than ours.
 *
 * `detail` is the part that only becomes clear if the learner asks. It is always revealed
 * eventually — at the end of the brief if nobody asked — because a scenario that lets you
 * arrive at `build` with a requirement you cannot satisfy is a bug, not a lesson.
 */
export interface Requirement {
  id: string;
  /** The headline, as first stated. */
  summary: string;
  /** What it turns out to mean. Revealed by a `pins` choice, or at the end of the brief. */
  detail: string;
  /** Which phase satisfies it, for the checklist. */
  satisfiedBy: ScenarioPhase;
}

/**
 * Something the learner has to do in the AOT before writing any code.
 *
 * Deliberately two narrow kinds, because these are the two the metadata model can check
 * honestly:
 *
 *   - `addToProject` — the gate that catches every newcomer. Application Explorer views
 *     the model and cannot edit it; an element has to be in a project first (VB-015).
 *   - `inspect` — open an element's designer and select a node. This is not busywork: the
 *     code in the build phase cannot be written without knowing the enum behind
 *     `CustTable.Blocked`, and the only place to find that out is the property grid.
 *
 * What is deliberately *not* here is adding a field. The Studio can add one to the
 * metadata and print the `ALTER TABLE` a synchronisation would run, but the engine's table
 * schemas are static, so X++ could not then read or write it. Asking a learner to create a
 * field their code cannot use would be teaching a dead end. See docs/unverified.md.
 */
export type AotWorkItem =
  | {
      kind: "addToProject";
      objectType: "table" | "class" | "form";
      name: string;
      prompt: string;
      hint: string;
    }
  | {
      kind: "inspect";
      objectType: "table" | "class" | "form";
      name: string;
      /** The designer node that has to be selected — a field name, for a table. */
      node: string;
      prompt: string;
      hint: string;
      /** What they are meant to come away knowing. Shown once they select it. */
      takeaway: string;
    };

/**
 * The acceptance test, in the sense the functional consultant means it.
 *
 * Same validator machinery as a lesson task, but framed as evidence: each check has a
 * name that reads like a test case, and the learner sees the list pass or fail rather
 * than a single verdict. UAT sign-off is gated on all of them.
 */
export interface AcceptanceCheck {
  id: string;
  /** "A customer 12% over their limit is blocked" — reads as a test case, not a rule. */
  name: string;
  validators: Validator[];
}

export interface ScenarioDefinition {
  slug: string;
  title: string;
  /** One line for the index card. */
  summary: string;
  /** What the learner is, in this story. */
  yourRole: string;
  estimatedMinutes: number;
  /** The dataset the whole scenario runs against. */
  seed: string;
  /** The legal entity the story happens in. */
  company: string;
  cast: Speaker[];
  conversation: ConversationTurn[];
  requirements: Requirement[];
  /** AOT changes required before the code will run. May be empty. */
  aotWork: AotWorkItem[];
  /** The development task — starter, solution, hints, validators, exactly as a lesson. */
  task: TaskDefinition;
  acceptance: AcceptanceCheck[];
  /** The change description the learner carries into the release phase. */
  release: {
    /** What the deployable package is called. Ours, not Microsoft's. */
    packageName: string;
    /** Suggested update name, which the learner can overwrite. */
    suggestedUpdateName: string;
  };
}
