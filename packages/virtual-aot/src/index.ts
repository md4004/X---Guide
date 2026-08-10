/**
 * @xpplab/virtual-aot — the metadata model.
 *
 * The AOT is plain JSON. "Deploying" is instant because nothing is deployed: the UI
 * re-reads the model and re-renders. Phase 7 gives it a tree explorer and property
 * grid; Phase 8 uses it to resolve Chain of Command.
 */

import type { XppError } from "@xpplab/xpp-core";

// ---------------------------------------------------------------------------
// Metadata objects
// ---------------------------------------------------------------------------

export type AotObjectType =
  | "table"
  | "tableExtension"
  | "edt"
  | "baseEnum"
  | "form"
  | "formExtension"
  | "class"
  | "classExtension"
  | "dataEntity";

export interface AotObjectRef {
  type: AotObjectType;
  name: string;
}

export interface EdtMetadata {
  name: string;
  baseType: "str" | "int" | "int64" | "real" | "date" | "utcdatetime" | "guid" | "container";
  extendsEdt?: string;
  stringSize?: number;
  label?: string;
  helpText?: string;
}

export interface EnumValueMetadata {
  name: string;
  value: number;
  label: string;
}

export interface BaseEnumMetadata {
  name: string;
  values: EnumValueMetadata[];
}

export interface FieldMetadata {
  name: string;
  edt?: string;
  enumName?: string;
  label?: string;
  mandatory?: boolean;
  allowEdit?: boolean;
  /** `true` when the field arrived via a table extension rather than the base table. */
  fromExtension?: string;
}

export interface FieldGroupMetadata {
  name: string;
  label: string;
  fields: string[];
}

export interface TableMetadata {
  name: string;
  label: string;
  fields: FieldMetadata[];
  fieldGroups: FieldGroupMetadata[];
  /** Methods declared on the table, including `display` methods. */
  methods: TableMethodMetadata[];
}

export interface TableMethodMetadata {
  name: string;
  returnType: string;
  isDisplay: boolean;
  fromExtension?: string;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export type FormControlType =
  | "grid"
  | "gridColumn"
  | "stringEdit"
  | "intEdit"
  | "realEdit"
  | "dateEdit"
  | "comboBox"
  | "checkBox"
  | "button"
  | "group"
  | "tab"
  | "tabPage";

export interface FormControlMetadata {
  name: string;
  type: FormControlType;
  label?: string;
  /** `TableName.FieldName` when the control is data-bound. */
  dataSource?: string;
  dataField?: string;
  children: FormControlMetadata[];
  fromExtension?: string;
}

export interface FormDataSourceMetadata {
  name: string;
  table: string;
  allowEdit: boolean;
  /** Nested data sources — the parent/child link an F&O form uses for header/lines. */
  children: FormDataSourceMetadata[];
}

export interface FormMetadata {
  name: string;
  caption: string;
  pattern: "SimpleList" | "SimpleListDetails" | "Details" | "TableOfContents";
  dataSources: FormDataSourceMetadata[];
  design: FormControlMetadata;
}

// ---------------------------------------------------------------------------
// Data entities (Phase 10)
// ---------------------------------------------------------------------------

export interface DataEntityMetadata {
  name: string;
  publicCollectionName: string;
  primaryKeyFields: string[];
  /** Entity field name to `Table.Field`. */
  mappings: Record<string, string>;
  isPublic: boolean;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface AotModel {
  tables: TableMetadata[];
  edts: EdtMetadata[];
  enums: BaseEnumMetadata[];
  forms: FormMetadata[];
  entities: DataEntityMetadata[];
  /**
   * Our own minimal teaching stubs standing in for standard classes. Labelled as stubs
   * in the UI — we do not ship Microsoft source. See CLAUDE.md > Legal rule.
   */
  stubClasses: StubClassMetadata[];
}

export interface StubClassMetadata {
  name: string;
  /** Shown in the UI so nobody mistakes this for real standard code. */
  teachingNote: string;
  methods: { name: string; returnType: string; parameters: string[] }[];
}

// ---------------------------------------------------------------------------
// Chain of Command
// ---------------------------------------------------------------------------

export type CocLinkKind = "preHandler" | "cocWrapper" | "base" | "postHandler";

export interface CocLink {
  kind: CocLinkKind;
  /** The class contributing this link — an extension class, or the base object. */
  declaringClass: string;
  methodName: string;
  /**
   * `false` on a `cocWrapper` that never calls `next`. This is the silently-broken
   * behaviour Phase 8's lesson is built around, so it is modelled explicitly rather
   * than inferred at render time.
   */
  callsNext: boolean;
}

/** The resolved call order for one method, outermost first. */
export interface CocChain {
  target: AotObjectRef;
  methodName: string;
  links: CocLink[];
  /** Links after the first non-`next`-calling wrapper — resolved but never reached. */
  unreachable: CocLink[];
}

// ---------------------------------------------------------------------------
// The AOT
// ---------------------------------------------------------------------------

export interface VirtualAot {
  getModel(): AotModel;

  getTable(name: string): TableMetadata | undefined;
  getEdt(name: string): EdtMetadata | undefined;
  getEnum(name: string): BaseEnumMetadata | undefined;
  getForm(name: string): FormMetadata | undefined;
  getEntity(name: string): DataEntityMetadata | undefined;

  /**
   * Apply a learner-authored extension and return the model with it merged in.
   * Fails rather than silently no-ops when the target does not exist — a typo'd
   * `[ExtensionOf]` target is one of the most common real-world mistakes.
   */
  applyExtension(extension: ExtensionDefinition): { ok: true } | { ok: false; error: XppError };

  removeExtension(name: string): void;
  listExtensions(): ExtensionDefinition[];

  /** Build the resolved call order for the chain visualiser. */
  resolveCoc(target: AotObjectRef, methodName: string): CocChain;

  /** Everything the Monaco completion provider needs, flattened. */
  listObjects(type?: AotObjectType): AotObjectRef[];

  /** Restores the model to its authored baseline, discarding learner extensions. */
  reset(): void;
}

export interface ExtensionDefinition {
  name: string;
  target: AotObjectRef;
  addedFields?: FieldMetadata[];
  addedControls?: { parentControl: string; control: FormControlMetadata }[];
  addedMethods?: { methodName: string; callsNext: boolean; kind: CocLinkKind }[];
}

export function createVirtualAot(_model?: AotModel): VirtualAot {
  throw new Error("not implemented");
}

/** The authored baseline model. TODO(phase-7): populate. */
export const BASE_MODEL: AotModel = {
  tables: [],
  edts: [],
  enums: [],
  forms: [],
  entities: [],
  stubClasses: [],
};
