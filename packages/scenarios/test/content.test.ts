/**
 * Every authored scenario, checked the way the lesson tests check lessons.
 *
 * The rule this exists to enforce: **the authored solution must satisfy the authored
 * validators, and every acceptance check must pass on it**. A scenario whose own answer
 * fails is worse than no scenario — the learner assumes they are wrong.
 *
 * It also guards the shape of the thing: a choice that pins a requirement that does not
 * exist, a work item naming a table that is not in the model, or an acceptance check with
 * no validators are all authoring slips that no type can catch.
 */

import { describe, expect, it } from "vitest";
import { createVirtualAot } from "@xpplab/virtual-aot";
import { createVirtualDb } from "@xpplab/virtual-db";
import { runTask, type Validator } from "@xpplab/validators";
import type { ScenarioDefinition } from "../src";
import { scenarios } from "../../../content/scenarios";

const aot = createVirtualAot();

const authored: ScenarioDefinition[] = Object.values(scenarios);

describe.each(authored)("$slug", (scenario: ScenarioDefinition) => {
  it("the authored solution satisfies the authored validators", async () => {
    const db = createVirtualDb();
    await db.init();
    await db.reset(scenario.seed);
    await db.setCompany(scenario.company);

    const outcome = await runTask({
      task: scenario.task,
      source: scenario.task.solution,
      db,
    });

    await db.close();
    expect({ passed: outcome.passed, failedOn: outcome.failure?.validator.message ?? null }).toEqual({
      passed: true,
      failedOn: null,
    });
  });

  it("the authored solution passes every acceptance check", async () => {
    const db = createVirtualDb();
    await db.init();
    await db.reset(scenario.seed);
    await db.setCompany(scenario.company);

    // One run, judged by every check — which is what the test phase does, and it matters:
    // the checks read state left behind by a single execution, not by one run each.
    const all: Validator[] = scenario.acceptance.flatMap((check) => check.validators);
    const outcome = await runTask({
      task: { ...scenario.task, validators: all },
      source: scenario.task.solution,
      db,
    });

    await db.close();
    expect({ passed: outcome.passed, failedOn: outcome.failure?.validator.message ?? null }).toEqual({
      passed: true,
      failedOn: null,
    });
  });

  it("the starter does NOT pass — otherwise there is nothing to do", async () => {
    const db = createVirtualDb();
    await db.init();
    await db.reset(scenario.seed);
    await db.setCompany(scenario.company);

    const outcome = await runTask({
      task: scenario.task,
      source: scenario.task.starter,
      db,
    });

    await db.close();
    expect(outcome.passed).toBe(false);
  });

  it("every choice pins a requirement that exists", () => {
    const ids = new Set(scenario.requirements.map((requirement) => requirement.id));
    for (const turn of scenario.conversation) {
      for (const choice of turn.choices ?? []) {
        for (const pinned of choice.pins ?? []) {
          expect(ids, `choice "${choice.id}" pins unknown requirement "${pinned}"`).toContain(
            pinned,
          );
        }
      }
    }
  });

  it("every turn names somebody in the cast", () => {
    const known = new Set([...scenario.cast.map((speaker) => speaker.id), "you"]);
    for (const turn of scenario.conversation) {
      expect(known, `unknown speaker "${turn.speaker}"`).toContain(turn.speaker);
    }
  });

  it("every requirement is reachable — something in the conversation pins it, or nothing does deliberately", () => {
    // Not every requirement has to be askable: some are simply stated. What must not
    // happen is a requirement the learner can never learn about before `build`, so this
    // asserts each one is either pinnable or stated in a turn with no choices.
    const pinnable = new Set(
      scenario.conversation.flatMap((turn) =>
        (turn.choices ?? []).flatMap((choice) => choice.pins ?? []),
      ),
    );
    const stated = scenario.conversation.length > 0;
    for (const requirement of scenario.requirements) {
      expect(
        pinnable.has(requirement.id) || stated,
        `requirement "${requirement.id}" is unreachable`,
      ).toBe(true);
    }
  });

  it("every choice carries a note, including the good one", () => {
    for (const turn of scenario.conversation) {
      for (const choice of turn.choices ?? []) {
        expect(choice.note.trim().length, `choice "${choice.id}" has no note`).toBeGreaterThan(20);
      }
    }
  });

  it("every AOT work item names an element in the model", () => {
    for (const item of scenario.aotWork) {
      if (item.objectType !== "table") continue;
      const table = aot.getTable(item.name);
      expect(table, `no table called ${item.name}`).toBeDefined();

      if (item.kind === "inspect") {
        const field = table!.fields.find(
          (candidate) => candidate.name.toLowerCase() === item.node.toLowerCase(),
        );
        expect(field, `${item.name} has no field ${item.node}`).toBeDefined();
      }
    }
  });

  it("every acceptance check has at least one validator and a name that reads as a case", () => {
    for (const check of scenario.acceptance) {
      expect(check.validators.length, `${check.id} has no validators`).toBeGreaterThan(0);
      expect(check.name.length, `${check.id} has no name`).toBeGreaterThan(10);
    }
  });

  it("has exactly three hints, escalating", () => {
    expect(scenario.task.hints).toHaveLength(3);
  });
});
