/**
 * The release pipeline, tested against the rules it claims to enforce.
 *
 * Each test cites the VB row it comes from. The refusals matter more than the happy path:
 * a simulator that lets you ship straight to production would be teaching a route the
 * platform does not have, which is exactly the failure CLAUDE.md's fidelity rule is about.
 */

import { describe, expect, it } from "vitest";
import {
  applyToSandbox,
  createDeployablePackage,
  createReleaseState,
  environment,
  isLive,
  markAsReleaseCandidate,
  scheduleProductionUpdate,
  signOff,
  uploadToAssetLibrary,
  validatePackage,
  type ReleaseOutcome,
  type ReleaseState,
} from "../src";

/** Unwraps a step that is expected to succeed, failing loudly with its message if not. */
function ok(outcome: ReleaseOutcome): ReleaseState {
  if (!outcome.ok) throw new Error(`expected success, got refusal: ${outcome.message}`);
  return outcome.state;
}

function refusal(outcome: ReleaseOutcome): { message: string; hint: string } {
  if (outcome.ok) throw new Error("expected a refusal, got success");
  return { message: outcome.message, hint: outcome.hint };
}

/** Everything up to a validated package sitting in the Asset library. */
function packaged(): ReleaseState {
  let state = createReleaseState();
  state = ok(createDeployablePackage(state, { name: "CreditHold", builtOn: "build" }));
  state = ok(uploadToAssetLibrary(state));
  return ok(validatePackage(state));
}

/** Everything up to a signed-off, release-candidate update on the sandbox. */
function releaseCandidate(updateName = "CreditHold-1.0"): ReleaseState {
  let state = ok(applyToSandbox(packaged(), updateName));
  state = ok(signOff(state, updateName, "signedOff"));
  return ok(markAsReleaseCandidate(state, updateName));
}

describe("creating and uploading a package", () => {
  it("arrives in the Asset library Not Validated (VB-073)", () => {
    let state = ok(createDeployablePackage(createReleaseState(), { name: "X", builtOn: "build" }));
    expect(state.package?.validation).toBe("notValidated");

    state = ok(uploadToAssetLibrary(state));
    expect(state.uploaded).toBe(true);
    expect(state.package?.validation).toBe("notValidated");

    state = ok(validatePackage(state));
    expect(state.package?.validation).toBe("validated");
  });

  it("says the package carries no source code (VB-071)", () => {
    const outcome = createDeployablePackage(createReleaseState(), { name: "X", builtOn: "build" });
    expect(outcome.ok && outcome.note).toContain("not your source code");
  });

  it("will not upload nothing", () => {
    expect(refusal(uploadToAssetLibrary(createReleaseState())).message).toContain(
      "no deployable package",
    );
  });
});

describe("applying to a sandbox", () => {
  it("refuses a package that has not passed validation (VB-073)", () => {
    let state = ok(createDeployablePackage(createReleaseState(), { name: "X", builtOn: "build" }));
    state = ok(uploadToAssetLibrary(state));

    const { message, hint } = refusal(applyToSandbox(state, "First"));
    expect(message).toContain("not passed validation");
    expect(hint).toContain("before it can be applied");
  });

  it("refuses a package that never reached the Asset library", () => {
    const state = ok(
      createDeployablePackage(createReleaseState(), { name: "X", builtOn: "build" }),
    );
    expect(refusal(applyToSandbox(state, "First")).message).toContain("not in the Asset library");
  });

  it("requires an update name, and says why it matters (VB-075)", () => {
    const { message, hint } = refusal(applyToSandbox(packaged(), "   "));
    expect(message).toContain("needs a name");
    expect(hint).toContain("promote to production");
  });

  it("refuses a duplicate update name (VB-075)", () => {
    const state = ok(applyToSandbox(packaged(), "CreditHold-1.0"));
    expect(refusal(applyToSandbox(state, "creditHold-1.0")).message).toContain("already an update");
  });

  it("moves the sandbox to the package version and records the history line", () => {
    const state = ok(applyToSandbox(packaged(), "CreditHold-1.0"));
    expect(environment(state, "sandbox").version).toBe(2);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      name: "CreditHold-1.0",
      appliedTo: "sandbox",
      status: "deployed",
      isReleaseCandidate: false,
    });
  });

  it("tells the learner the environment was down while it ran (VB-074, VB-076)", () => {
    const outcome = applyToSandbox(packaged(), "CreditHold-1.0");
    expect(outcome.ok && outcome.note).toContain("Post-servicing");
    expect(outcome.ok && outcome.note).toContain("five hours");
  });

  it("leaves production untouched", () => {
    const state = ok(applyToSandbox(packaged(), "CreditHold-1.0"));
    expect(environment(state, "production").version).toBe(1);
    expect(isLive(state)).toBe(false);
  });
});

describe("sign-off (VB-077)", () => {
  it("records the verdict against the update", () => {
    const state = ok(signOff(ok(applyToSandbox(packaged(), "U1")), "U1", "signedOffWithIssues"));
    expect(state.history[0]?.signOff).toBe("signedOffWithIssues");
  });

  it("refuses twice", () => {
    const state = ok(signOff(ok(applyToSandbox(packaged(), "U1")), "U1", "signedOff"));
    expect(refusal(signOff(state, "U1", "signedOff")).message).toContain("already signed off");
  });

  it("refuses an update nobody has heard of", () => {
    expect(refusal(signOff(packaged(), "nope", "signedOff")).message).toContain("No update called");
  });
});

describe("marking a release candidate (VB-079)", () => {
  it("refuses an update that was never applied to a sandbox", () => {
    expect(refusal(markAsReleaseCandidate(packaged(), "U1")).message).toContain("No update called");
  });

  it("refuses one that nobody signed off, and says why that is our rule", () => {
    const state = ok(applyToSandbox(packaged(), "U1"));
    const { message, hint } = refusal(markAsReleaseCandidate(state, "U1"));
    expect(message).toContain("signed off");
    expect(hint).toContain("does not enforce this one");
  });

  it("sets Is Release Candidate to Yes", () => {
    expect(releaseCandidate().history[0]?.isReleaseCandidate).toBe(true);
  });
});

describe("promoting to production (VB-078, VB-080)", () => {
  it("refuses a package name — production's grid lists sandbox updates, not packages", () => {
    const state = releaseCandidate();
    const { message, hint } = refusal(
      scheduleProductionUpdate(state, { updateName: "CreditHold", downtimeStart: "2026-09-01T22:00" }),
    );
    expect(message).toContain("No update called");
    expect(hint).toContain("no longer apply packages directly to production");
  });

  it("refuses an update that is not a release candidate", () => {
    const state = ok(signOff(ok(applyToSandbox(packaged(), "U1")), "U1", "signedOff"));
    const { message, hint } = refusal(
      scheduleProductionUpdate(state, { updateName: "U1", downtimeStart: "2026-09-01T22:00" }),
    );
    expect(message).toContain("not marked as a release candidate");
    expect(hint).toContain("Mark as release candidate");
  });

  it("requires a downtime window (VB-080)", () => {
    const { message, hint } = refusal(
      scheduleProductionUpdate(releaseCandidate(), { updateName: "CreditHold-1.0" }),
    );
    expect(message).toContain("has to be scheduled");
    expect(hint).toContain("Downtime start");
  });

  it("refuses a downgrade (VB-080)", () => {
    // Production has already moved past this update's version.
    let state = releaseCandidate();
    environment(state, "production").version = 9;
    state = { ...state, environments: state.environments.map((item) => ({ ...item })) };

    const { message, hint } = refusal(
      scheduleProductionUpdate(state, {
        updateName: "CreditHold-1.0",
        downtimeStart: "2026-09-01T22:00",
      }),
    );
    expect(message).toContain("already on 9");
    expect(hint).toContain("prevent a downgrade");
  });

  it("goes live, and says the whole image moved (VB-078)", () => {
    const outcome = scheduleProductionUpdate(releaseCandidate(), {
      updateName: "CreditHold-1.0",
      downtimeStart: "2026-09-01T22:00",
    });

    const state = ok(outcome);
    expect(isLive(state)).toBe(true);
    expect(environment(state, "production").version).toBe(2);
    expect(state.history.at(-1)).toMatchObject({
      appliedTo: "production",
      promotedFrom: "UAT",
      downtimeStart: "2026-09-01T22:00",
    });
    expect(outcome.ok && outcome.note).toContain("whole image");
  });
});

describe("the shortest path a learner will try", () => {
  it("cannot reach production without going through the sandbox at all", () => {
    let state = ok(createDeployablePackage(createReleaseState(), { name: "X", builtOn: "build" }));
    state = ok(uploadToAssetLibrary(state));
    state = ok(validatePackage(state));

    // Nothing on the history page, so there is nothing production can be pointed at.
    const { hint } = refusal(
      scheduleProductionUpdate(state, { updateName: "X", downtimeStart: "2026-09-01T22:00" }),
    );
    expect(hint).toContain("no longer apply packages directly to production");
    expect(isLive(state)).toBe(false);
  });
});
