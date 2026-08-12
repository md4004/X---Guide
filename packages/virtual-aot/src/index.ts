/**
 * @xpplab/virtual-aot — the metadata model.
 *
 * The AOT is plain JSON. "Deploying" is instant because nothing is deployed: the UI
 * re-reads the model and re-renders.
 *
 *   types.ts       the shapes
 *   model.ts       the authored baseline — tables derived from the database schema
 *   aot.ts         lookups over the model
 *   validation.ts  validateField / validateWrite, driven by the field properties
 *   designer.ts    the Application Explorer tree, element designers, property grid
 *
 * Extensions and Chain of Command resolution are declared in `types.ts` and refused at
 * runtime; they belong to the customisation track.
 */

export * from "./types";
export { createVirtualAot } from "./aot";
export { BASE_MODEL, EDTS, ENTITIES, FORMS, REPORTS } from "./model";

export {
  addField,
  addToProject,
  build,
  createProject,
  isInProject,
  markSynchronised,
  planSynchronisation,
} from "./project";
export type {
  BuildMessage,
  BuildMessageSeverity,
  BuildResult,
  ProjectOutcome,
  ProjectProperties,
  ProjectState,
  SyncPlan,
} from "./project";

export { buildApplicationExplorer, buildDesigner, findNode, orderProperties } from "./designer";
export type {
  DesignerNode,
  DesignerNodeKind,
  PropertyCategory,
  PropertyGroup,
  PropertyOrdering,
  PropertyValue,
} from "./designer";
export { validateField, validateWrite } from "./validation";
export type {
  RecordValues,
  ValidateWriteOptions,
  ValidationFailure,
  ValidationResult,
} from "./validation";
