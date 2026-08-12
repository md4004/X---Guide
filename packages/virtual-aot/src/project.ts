/**
 * A finance and operations project, and what building one does.
 *
 * This module exists for one behaviour: **Application Explorer cannot edit anything**
 * (VB-015). Viewing the whole model store is one tool; changing an element is another, and
 * the second needs the element to be in a project first. Newcomers lose hours to this —
 * they find `InventTable` in the AOT, try to add a field, and nothing happens.
 *
 * So `addField` refuses unless the table has been added to the project, and the refusal
 * says why. That is the lesson, enforced rather than narrated.
 *
 * A build (VB-020) and a database synchronisation (VB-021) are simulated as far as they
 * honestly can be: the step names are the real ones, the metadata validation genuinely
 * runs, and nothing claims to have compiled X++ to IL.
 */

import type { AotObjectRef, FieldMetadata, TableMetadata, VirtualAot } from "./types";

/** What a project property page shows (VB-026, VB-021). */
export interface ProjectProperties {
  /** Must be a form, a class with a `main` method, or a menu item (VB-026). */
  startupObject?: string;
  startupObjectType?: "Form" | "Class" | "Menu Item";
  /** VB-021. `true` is the product default, and the reason a first build is slow. */
  synchronizeDatabaseOnBuild: boolean;
}

export interface ProjectState {
  name: string;
  /** A project always belongs to exactly one model. */
  model: string;
  elements: AotObjectRef[];
  properties: ProjectProperties;
  /** Fields added through this project but not yet synchronised to the database. */
  pendingFields: { table: string; field: FieldMetadata }[];
}

export type ProjectOutcome<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : { value: T }))
  | { ok: false; message: string; hint: string };

const failure = (message: string, hint: string): { ok: false; message: string; hint: string } => ({
  ok: false,
  message,
  hint,
});

/** Severity of a line in the Error List pane. */
export type BuildMessageSeverity = "error" | "warning";

export interface BuildMessage {
  severity: BuildMessageSeverity;
  message: string;
  element: string;
}

export interface BuildResult {
  ok: boolean;
  /**
   * The Output pane, one line per step.
   *
   * The step names are the ones the build genuinely performs in the real product, in the
   * documented order (VB-020). Steps this simulator does not perform say so rather than
   * printing a reassuring tick — a learner should not come away believing their X++ was
   * compiled to IL in a browser tab.
   */
  output: string[];
  /** The Error List pane. */
  messages: BuildMessage[];
  /** `true` when the build ran a database synchronisation as part of itself (VB-021). */
  synchronised: boolean;
}

export function createProject(name: string, model: string): ProjectState {
  return {
    name,
    model,
    elements: [],
    properties: { synchronizeDatabaseOnBuild: true },
    pendingFields: [],
  };
}

const same = (left: AotObjectRef, right: AotObjectRef): boolean =>
  left.type === right.type && left.name.toLowerCase() === right.name.toLowerCase();

/** **Add to project**, the Application Explorer command that makes an element editable. */
export function addToProject(project: ProjectState, ref: AotObjectRef): ProjectOutcome {
  if (project.elements.some((element) => same(element, ref))) {
    return failure(
      `${ref.name} is already in ${project.name}.`,
      "An element belongs to a project once. Open it from Solution Explorer to edit it.",
    );
  }

  project.elements.push(ref);
  return { ok: true } as ProjectOutcome;
}

export function isInProject(project: ProjectState, ref: AotObjectRef): boolean {
  return project.elements.some((element) => same(element, ref));
}

/**
 * Adds a field to a table, the way right-clicking **Fields > New > String** does (VB-019).
 *
 * Refuses when the table is not in the project, because that is exactly what the real tool
 * does — Application Explorer's designer opens read-only.
 */
export function addField(
  project: ProjectState,
  aot: VirtualAot,
  tableName: string,
  field: FieldMetadata,
): ProjectOutcome {
  const table = aot.getTable(tableName);
  if (table === undefined) {
    return failure(`There is no table called ${tableName}.`, "Check the name in the AOT.");
  }

  if (!isInProject(project, { type: "table", name: table.name })) {
    return failure(
      `${table.name} is not in ${project.name}, so its designer is read-only.`,
      "Find the table in Application Explorer, right-click it, and select Add to project. Application Explorer itself only ever views elements — creating and editing needs a project.",
    );
  }

  if (table.fields.some((existing) => existing.name.toLowerCase() === field.name.toLowerCase())) {
    return failure(
      `${table.name} already has a field called ${field.name}.`,
      "Field names are unique within a table, and are compared case-insensitively.",
    );
  }

  // The metadata changes immediately; the *database* does not, until a synchronisation.
  // That gap is the whole reason "Synchronize database" is a separate command.
  table.fields.push(field);
  project.pendingFields.push({ table: table.name, field });
  return { ok: true } as ProjectOutcome;
}

/**
 * Builds the project.
 *
 * Metadata validation is real: it checks what this model can actually check. The compile
 * and IL-generation steps are named because they are part of a real build and a learner
 * should know the list, but they report honestly that nothing was compiled.
 */
export function build(project: ProjectState, aot: VirtualAot): BuildResult {
  const output: string[] = [`------ Build started: Project: ${project.name} ------`];
  const messages: BuildMessage[] = [];

  const tables = project.elements
    .filter((ref) => ref.type === "table")
    .map((ref) => aot.getTable(ref.name))
    .filter((table): table is TableMetadata => table !== undefined);

  // 1. Metadata validation — genuinely performed.
  output.push("Metadata validation...");
  for (const table of tables) {
    for (const field of table.fields) {
      if (field.label.trim() === "") {
        messages.push({
          severity: "warning",
          element: `${table.name}.${field.name}`,
          message:
            "Field has no label, so a form will show its name to the user. Set a Label, or give it an EDT that carries one.",
        });
      }
    }
    if (!table.indexes.some((index) => index.primary)) {
      messages.push({
        severity: "warning",
        element: table.name,
        message: "Table has no primary index.",
      });
    }
  }

  // 2. X++ code validation. There is no X++ attached to an element in this simulator —
  // code lives in the editor and is checked when it runs — so this reports nothing rather
  // than reporting success it did not establish.
  output.push("X++ code validation... (no element-attached code in this simulator)");

  // 3. Best practice checks. Microsoft does not publish the rule ids or their wording, so
  // the warnings above are ours and are labelled as such. See docs/unverified.md.
  output.push(`Best practice checks... ${messages.length} warning(s)`);

  output.push("Report RDL generation... (not simulated)");
  output.push("Compilation and IL generation... (not simulated — X++ is interpreted here)");
  output.push("Label assembly generation... (not simulated)");

  const synchronised = project.properties.synchronizeDatabaseOnBuild;
  output.push(
    synchronised
      ? "Database synchronization..."
      : "Database synchronization skipped — Synchronize database on build is false.",
  );

  const errors = messages.filter((message) => message.severity === "error").length;
  output.push(
    `========== Build: ${errors === 0 ? "1 succeeded" : "0 succeeded, 1 failed"}, ${messages.length} warning(s) ==========`,
  );

  return { ok: errors === 0, output, messages, synchronised };
}

/**
 * What a database synchronisation has to do, given what the project has changed.
 *
 * Returned rather than executed: the schema lives in `virtual-db`, and a metadata package
 * has no business reaching into it. The Studio applies the plan.
 */
export interface SyncPlan {
  statements: string[];
  fields: { table: string; field: FieldMetadata }[];
}

export function planSynchronisation(project: ProjectState): SyncPlan {
  return {
    fields: [...project.pendingFields],
    statements: project.pendingFields.map(
      ({ table, field }) => `ALTER TABLE ${table} ADD ${field.name} ${sqlTypeFor(field)}`,
    ),
  };
}

function sqlTypeFor(field: FieldMetadata): string {
  switch (field.baseType) {
    case "int":
    case "int64":
    case "enum":
      return "INTEGER";
    case "real":
      return "REAL";
    case "container":
      return "BLOB";
    default:
      return "TEXT";
  }
}

/** Clears the pending list once the Studio has applied a plan. */
export function markSynchronised(project: ProjectState): void {
  project.pendingFields = [];
}
