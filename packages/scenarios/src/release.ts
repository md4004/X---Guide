/**
 * Getting the change into production.
 *
 * This models the **self-service / next-generation infrastructure** flow (VB-070 to
 * VB-081), which is the current one. It exists because "write the code" is about half of
 * the job, and the other half is a gated pipeline that a developer meets for the first
 * time on a real project, usually the evening before go-live.
 *
 * Every refusal below is a gate the platform genuinely enforces, and every message says
 * which rule it is. The one that matters most:
 *
 *   > "You no longer apply packages directly to production environments." (VB-078)
 *
 * A learner who finishes this having internalised *dev → sandbox → sign off → mark as
 * release candidate → schedule production* has learned the shape of every F&O release
 * they will ever do.
 *
 * What this does **not** model, deliberately: how long servicing takes, what makes a
 * package fail Asset library validation, and what a failed runbook step looks like. See
 * docs/unverified.md. The gates are documented; the failure modes are not.
 */

export type EnvironmentTier = "dev" | "sandbox" | "production";

/**
 * The servicing status shown in the top-right of the environment details page (VB-076).
 *
 * `postServicing` is the interesting one: the environment is back up, users are in, and
 * index work is still finishing. A learner who thinks "Deployed" is the only good state
 * will panic at it.
 */
export type ServicingStatus =
  | "deployed"
  | "queued"
  | "servicing"
  | "postServicing"
  | "failed";

/** Asset library validation state (VB-073). */
export type PackageValidation = "notValidated" | "validated" | "failed";

export interface DeployablePackage {
  name: string;
  /**
   * Where it was built. A dev box may build one, but not for the production path
   * (VB-072).
   */
  builtOn: "dev" | "build";
  /** Set once it reaches the Asset library. */
  validation: PackageValidation;
  /**
   * The application version this package carries. Compared against the target on a
   * production schedule, because a downgrade is refused (VB-080).
   */
  version: number;
}

/**
 * One line of History > Environment changes.
 *
 * This is the *image*, not the package: in the modern flow the thing that moves to
 * production is the whole runtime — Microsoft binary plus every custom package — under
 * the Update name you gave it (VB-078).
 */
export interface UpdateRecord {
  /** The unique Update name the learner typed (VB-075). */
  name: string;
  packageName: string;
  version: number;
  appliedTo: EnvironmentTier;
  status: ServicingStatus;
  /** VB-077. `undefined` until the learner signs off. */
  signOff?: "signedOff" | "signedOffWithIssues";
  /** VB-079. */
  isReleaseCandidate: boolean;
  /** Set on a production update: the sandbox the image was promoted from. */
  promotedFrom?: string;
  /** ISO string of the scheduled downtime start, on a production update (VB-080). */
  downtimeStart?: string;
}

export interface EnvironmentState {
  name: string;
  tier: EnvironmentTier;
  status: ServicingStatus;
  version: number;
}

export interface ReleaseState {
  /** Undefined until the learner creates one in Visual Studio. */
  package?: DeployablePackage;
  /** Undefined until it is uploaded to the LCS Asset library. */
  uploaded: boolean;
  environments: EnvironmentState[];
  /** History > Environment changes, newest last. */
  history: UpdateRecord[];
}

export type ReleaseOutcome =
  | { ok: true; state: ReleaseState; note: string }
  | { ok: false; message: string; hint: string };

const refuse = (message: string, hint: string): ReleaseOutcome => ({
  ok: false,
  message,
  hint,
});

/**
 * The three environments a small project has.
 *
 * Names are ours. The tiers are the documented ones: Tier-1 dev/build, Tier-2 and higher
 * "Standard Acceptance Test" sandbox, and production.
 */
export function createReleaseState(): ReleaseState {
  return {
    uploaded: false,
    environments: [
      { name: "DEV-01", tier: "dev", status: "deployed", version: 1 },
      { name: "UAT", tier: "sandbox", status: "deployed", version: 1 },
      { name: "PROD", tier: "production", status: "deployed", version: 1 },
    ],
    history: [],
  };
}

export function environment(state: ReleaseState, tier: EnvironmentTier): EnvironmentState {
  const found = state.environments.find((candidate) => candidate.tier === tier);
  if (found === undefined) throw new Error(`no ${tier} environment`);
  return found;
}

const clone = (state: ReleaseState): ReleaseState => ({
  ...state,
  package: state.package === undefined ? undefined : { ...state.package },
  environments: state.environments.map((item) => ({ ...item })),
  history: state.history.map((item) => ({ ...item })),
});

/**
 * **Dynamics 365 > Deploy > Create Deployment Package** (VB-070).
 *
 * `builtOn` is asked for rather than assumed because the answer matters later: a package
 * built on a dev box is fine for a sandbox and wrong for the production path (VB-072).
 */
export function createDeployablePackage(
  state: ReleaseState,
  options: { name: string; builtOn: "dev" | "build" },
): ReleaseOutcome {
  if (options.name.trim() === "") {
    return refuse("A deployable package needs a name.", "Name it after the change it carries.");
  }

  const next = clone(state);
  next.package = {
    name: options.name.trim(),
    builtOn: options.builtOn,
    validation: "notValidated",
    version: environment(state, "dev").version + 1,
  };
  next.uploaded = false;
  return {
    ok: true,
    state: next,
    note: "Package created. It contains metadata and binaries — not your source code.",
  };
}

/** Upload to the Lifecycle Services **Asset library** (VB-070). Arrives Not Validated. */
export function uploadToAssetLibrary(state: ReleaseState): ReleaseOutcome {
  if (state.package === undefined) {
    return refuse(
      "There is no deployable package to upload.",
      "Create one first: Dynamics 365 > Deploy > Create Deployment Package.",
    );
  }
  if (state.uploaded) {
    return refuse(
      `${state.package.name} is already in the Asset library.`,
      "Select it and check its validation status in the right-hand pane.",
    );
  }

  const next = clone(state);
  next.uploaded = true;
  next.package!.validation = "notValidated";
  return {
    ok: true,
    state: next,
    note: "Uploaded. The Asset library does not analyse a package on upload — its status is Not Validated until you run validation.",
  };
}

/**
 * Asset library validation (VB-073).
 *
 * Three documented kinds of check — package format, platform version, package type. We do
 * not model what makes one fail, so this always succeeds; the point being taught is that
 * the step exists and blocks the apply until it has run.
 */
export function validatePackage(state: ReleaseState): ReleaseOutcome {
  if (state.package === undefined || !state.uploaded) {
    return refuse(
      "Nothing in the Asset library to validate.",
      "Upload the deployable package first.",
    );
  }
  if (state.package.validation === "validated") {
    return refuse(`${state.package.name} has already passed validation.`, "Move on and apply it.");
  }

  const next = clone(state);
  next.package!.validation = "validated";
  return {
    ok: true,
    state: next,
    note: "Validation passed: package format, platform version, package type. Only validated packages appear in the Apply updates list.",
  };
}

/**
 * **Maintain > Apply updates** on a sandbox (VB-075).
 *
 * The Update name is the whole reason this step takes an argument. It is not a label for
 * the history page — it is what you select later when promoting the image to production,
 * so a learner who types "test" here meets their own carelessness two steps on.
 */
export function applyToSandbox(state: ReleaseState, updateName: string): ReleaseOutcome {
  const name = updateName.trim();
  const target = environment(state, "sandbox");

  if (state.package === undefined) {
    return refuse(
      "There is no package to apply.",
      "Create a deployable package and upload it to the Asset library first.",
    );
  }
  if (!state.uploaded) {
    return refuse(
      `${state.package.name} is not in the Asset library.`,
      "Lifecycle Services can only apply what the Asset library holds. Upload it.",
    );
  }
  if (state.package.validation !== "validated") {
    return refuse(
      `${state.package.name} has not passed validation, so it does not appear in the Apply updates list.`,
      "A package must pass Asset library validation before it can be applied to any environment.",
    );
  }
  if (name === "") {
    return refuse(
      "An update needs a name.",
      "Maintain > Apply updates asks for a unique Update name. It identifies the image you will later promote to production, so make it mean something.",
    );
  }
  if (state.history.some((record) => record.name.toLowerCase() === name.toLowerCase())) {
    return refuse(
      `There is already an update called "${name}".`,
      "Update names are unique within the project — they are how you tell two images apart on the environment history page.",
    );
  }

  const next = clone(state);
  const sandbox = environment(next, "sandbox");
  sandbox.status = "deployed";
  sandbox.version = state.package.version;
  next.history.push({
    name,
    packageName: state.package.name,
    version: state.package.version,
    appliedTo: "sandbox",
    status: "deployed",
    isReleaseCandidate: false,
  });

  return {
    ok: true,
    state: next,
    note: `Applied to ${target.name}. Queued → Servicing → Post-servicing → Deployed. Everyone was locked out while it ran — applying an update takes the environment down, around five hours for a single package.`,
  };
}

/** **History > Environment changes > Sign off** (VB-077). The UAT acceptance step. */
export function signOff(
  state: ReleaseState,
  updateName: string,
  verdict: "signedOff" | "signedOffWithIssues",
): ReleaseOutcome {
  const next = clone(state);
  const record = next.history.find((item) => item.name === updateName);

  if (record === undefined) {
    return refuse(`No update called "${updateName}" on the environment history.`, "Check the name.");
  }
  if (record.status !== "deployed") {
    return refuse(
      `${updateName} has not finished servicing.`,
      "Sign-off comes after the update is Deployed and the validations have completed.",
    );
  }
  if (record.signOff !== undefined) {
    return refuse(`${updateName} is already signed off.`, "One sign-off per update.");
  }

  record.signOff = verdict;
  return {
    ok: true,
    state: next,
    note:
      verdict === "signedOff"
        ? "Signed off. That is the business accepting the change, recorded against the update itself rather than in somebody's inbox."
        : "Signed off with issues. The update is accepted and the problems are on the record — which is the honest option when go-live will not move.",
  };
}

/**
 * **Mark as release candidate** (VB-079).
 *
 * The gate that makes the whole exercise worth doing. An update that was never applied to
 * a sandbox cannot be marked, and an unmarked update never appears in production's grid.
 */
export function markAsReleaseCandidate(state: ReleaseState, updateName: string): ReleaseOutcome {
  const next = clone(state);
  const record = next.history.find((item) => item.name === updateName);

  if (record === undefined) {
    return refuse(
      `No update called "${updateName}" on the environment history.`,
      "You mark an update that a sandbox already ran — there is nothing else to mark.",
    );
  }
  if (record.appliedTo !== "sandbox") {
    return refuse(
      "Only a sandbox update can be marked as a release candidate.",
      "Production updates are the result of a promotion, not the source of one.",
    );
  }
  if (record.status !== "deployed") {
    return refuse(`${updateName} has not finished servicing.`, "Wait for Deployed.");
  }
  if (record.signOff === undefined) {
    return refuse(
      `Nobody has signed off ${updateName} yet.`,
      "Lifecycle Services does not enforce this one — but promoting an image that UAT never accepted is how an untested change reaches production. Sign off first.",
    );
  }
  if (record.isReleaseCandidate) {
    return refuse(`${updateName} is already a release candidate.`, "Is Release Candidate is Yes.");
  }

  record.isReleaseCandidate = true;
  return {
    ok: true,
    state: next,
    note: "Is Release Candidate is now Yes. Production's update grid shows release candidates and nothing else.",
  };
}

/**
 * **Maintain > Update environment** on production (VB-080).
 *
 * Note what is being moved: not the package, the *image* — the whole runtime, Microsoft
 * binary and every custom package together. You cannot promote them separately, which is
 * the detail that surprises people who expect to ship only their own change.
 */
export function scheduleProductionUpdate(
  state: ReleaseState,
  options: { updateName: string; downtimeStart?: string },
): ReleaseOutcome {
  const next = clone(state);
  const record = next.history.find((item) => item.name === options.updateName);
  const production = environment(next, "production");

  if (record === undefined) {
    return refuse(
      `No update called "${options.updateName}".`,
      "Production's grid lists updates from a sandbox's history, not packages from the Asset library. You no longer apply packages directly to production.",
    );
  }
  if (!record.isReleaseCandidate) {
    return refuse(
      `${options.updateName} is not marked as a release candidate, so it is not in the list.`,
      "Open the sandbox's History > Environment changes, select the update, and choose Mark as release candidate.",
    );
  }
  if (record.version <= production.version) {
    return refuse(
      `${options.updateName} carries version ${record.version}, and ${production.name} is already on ${production.version}.`,
      "Lifecycle Services refuses an update whose application version is lower than the environment's, to prevent a downgrade.",
    );
  }
  if (options.downtimeStart === undefined || options.downtimeStart.trim() === "") {
    return refuse(
      "A production update has to be scheduled.",
      "Pick a Downtime start. The environment goes down at that moment and Downtime end is calculated for you — no lead time is required, but the window is real.",
    );
  }

  production.version = record.version;
  production.status = "deployed";
  next.history.push({
    name: options.updateName,
    packageName: record.packageName,
    version: record.version,
    appliedTo: "production",
    status: "deployed",
    isReleaseCandidate: false,
    promotedFrom: environment(next, "sandbox").name,
    downtimeStart: options.downtimeStart,
  });

  return {
    ok: true,
    state: next,
    note: "Scheduled, serviced, deployed. What moved was the whole image — the Microsoft binary and every custom package as one unit. You cannot promote your own change on its own.",
  };
}

/** True once the change is live in production. The scenario's finish line. */
export function isLive(state: ReleaseState): boolean {
  return state.history.some(
    (record) => record.appliedTo === "production" && record.status === "deployed",
  );
}
