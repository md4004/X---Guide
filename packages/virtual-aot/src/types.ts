/**
 * The metadata model's shapes.
 *
 * Types only. `model.ts` builds the baseline, `aot.ts` serves it, `validation.ts` turns
 * the field properties declared here into the checks a form would run.
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

/** The X++ base types a field can have. Mirrors `FieldType` in the database schema. */
export type FieldBaseType =
  "str" | "int" | "int64" | "real" | "date" | "utcdatetime" | "enum" | "guid" | "container";

export interface FieldMetadata {
  name: string;
  label: string;
  /** Drives which control a form renders. Derived from the schema, never guessed. */
  baseType: FieldBaseType;
  edt?: string;
  enumName?: string;
  /** The form engine refuses to save a record with this field empty. */
  mandatory: boolean;
  /** `false` makes the control read-only on a form. */
  allowEdit: boolean;
  /** Set when the field arrived via a table extension rather than the base table. */
  fromExtension?: string;
}

export interface FieldGroupMetadata {
  name: string;
  label: string;
  fields: string[];
}

export interface TableMethodMetadata {
  name: string;
  returnType: string;
  isDisplay: boolean;
  fromExtension?: string;
}

export interface IndexMetadata {
  name: string;
  fields: string[];
  allowDuplicates: boolean;
  /** The index the table's `PrimaryIndex` property points at. */
  primary: boolean;
}

export interface RelationMetadata {
  name: string;
  relatedTable: string;
  /** `[thisField, relatedField]` pairs. */
  fields: { field: string; relatedField: string }[];
}

export interface TableMetadata {
  name: string;
  label: string;
  fields: FieldMetadata[];
  fieldGroups: FieldGroupMetadata[];
  /**
   * Indexes and relations are carried because they are two of the five nodes a table
   * designer opens with, and a designer that showed an empty `Indexes` node over a table
   * that has indexes would misrepresent the element it exists to explain.
   */
  indexes: IndexMetadata[];
  relations: RelationMetadata[];
  /** Methods declared on the table, including `display` methods. */
  methods: TableMethodMetadata[];
  /** `false` for a table shared across legal entities rather than company-scoped. */
  saveDataPerCompany: boolean;
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
  /** The data source name the control binds to. */
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

/**
 * What an entity is *for*, which decides what a data migration does with it (VB-053).
 *
 * Not decoration: `Transaction` entities are the ones you generally do not migrate in
 * detail, and knowing the category is how you tell.
 */
export type DataEntityCategory = "Parameter" | "Reference" | "Master" | "Document" | "Transaction";

/** A related table an entity de-normalises fields out of. */
export interface DataEntityJoin {
  table: string;
  /** `Field` on the primary table. */
  fromField: string;
  /** `Field` on the joined table. */
  toField: string;
}

export interface DataEntityMetadata {
  name: string;
  publicCollectionName: string;
  category: DataEntityCategory;
  /** The root data source the entity is built on. */
  primaryTable: string;
  /**
   * Extra data sources, which is what makes an entity a *de-normalised view* rather than
   * a second name for a table (VB-052). Joined for reads; writes go to the primary table.
   */
  joins: DataEntityJoin[];
  primaryKeyFields: string[];
  /** Entity field name to `Table.Field`. */
  mappings: Record<string, string>;
  /** **Enable public API** — whether it appears on the OData endpoint at all (VB-055). */
  isPublic: boolean;
  /**
   * **Enable data management capabilities** — whether the DMF and the batch data APIs can
   * see it. Independent of `isPublic`, which is why an entity can be reachable by one
   * integration route and invisible to the other (VB-054).
   */
  dataManagementEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * A report element: the metadata that ties a design to the class that feeds it.
 *
 * This is the piece a learner cannot see from their own code, and the piece that explains
 * how a controller finds anything. `SrsReportRunController` is given a *report name* and
 * nothing else — everything it needs to run comes from here.
 */
export interface ReportMetadata {
  name: string;
  /** The design within the report, which is what `ssrsReportStr(Report, Design)` names. */
  design: string;
  /** The RDP class whose `processReport()` fills the dataset. */
  dataProviderClass: string;
  /** The `[SRSReportDataSetAttribute]` name the design binds to. */
  dataSetName: string;
  /** The temporary table the provider writes and the design reads. */
  table: string;
  /** The root table of the query handed to the provider as `parmQuery()`. */
  queryTable: string;
  /** Grouping and totals, which live in the design rather than in the provider. */
  groupBy: string[];
  totals: { column: string; aggregate: "sum" | "count" | "avg" }[];
  title: string;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface StubClassMetadata {
  name: string;
  /** Shown in the UI so nobody mistakes this for real standard code. */
  teachingNote: string;
  methods: { name: string; returnType: string; parameters: string[] }[];
}

export interface AotModel {
  tables: TableMetadata[];
  edts: EdtMetadata[];
  enums: BaseEnumMetadata[];
  forms: FormMetadata[];
  entities: DataEntityMetadata[];
  reports: ReportMetadata[];
  /**
   * Our own minimal teaching stubs standing in for standard classes. Labelled as stubs
   * in the UI — we do not ship Microsoft source. See CLAUDE.md > Legal rule.
   */
  stubClasses: StubClassMetadata[];
}

// ---------------------------------------------------------------------------
// Chain of Command (Phase 8)
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

export interface ExtensionDefinition {
  name: string;
  target: AotObjectRef;
  addedFields?: FieldMetadata[];
  addedControls?: { parentControl: string; control: FormControlMetadata }[];
  addedMethods?: { methodName: string; callsNext: boolean; kind: CocLinkKind }[];
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
  getReport(name: string): ReportMetadata | undefined;

  /** One field's metadata, resolved case-insensitively as X++ resolves identifiers. */
  getField(tableName: string, fieldName: string): FieldMetadata | undefined;

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
