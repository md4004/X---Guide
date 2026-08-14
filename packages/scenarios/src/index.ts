/**
 * Scenarios: a whole job, from somebody asking for it to it being live.
 *
 * Pure data and pure state transitions. No React, no engine, no database — the app layer
 * wires this to the same worker and the same validators the lessons use.
 */

export type {
  AcceptanceCheck,
  AotWorkItem,
  ConversationTurn,
  ReplyChoice,
  Requirement,
  ScenarioDefinition,
  ScenarioPhase,
  Speaker,
} from "./types";
export { PHASE_ORDER } from "./types";

export type { BriefState, KnownRequirement } from "./brief";
export {
  advance,
  awaitingReply,
  createBriefState,
  isBriefComplete,
  reply,
  requirementsFor,
  visibleTurns,
} from "./brief";

export type {
  DeployablePackage,
  EnvironmentState,
  EnvironmentTier,
  PackageValidation,
  ReleaseOutcome,
  ReleaseState,
  ServicingStatus,
  UpdateRecord,
} from "./release";
export {
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
} from "./release";
