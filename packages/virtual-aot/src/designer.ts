/**
 * The Application Explorer tree and the element designers.
 *
 * Two trees, and the difference between them is the single most consequential fact about
 * this IDE:
 *
 * - `buildApplicationExplorer` is the **AOT**. It shows every element in the model store,
 *   grouped by type, and it cannot change any of them (VB-015).
 * - `buildDesigner` opens one element and shows its parts — the `Fields`, `Field Groups`,
 *   `Indexes`, `Relations` and `Methods` nodes of a table. Editing happens here, and only
 *   for an element that has been added to a project.
 *
 * Both are pure functions over the metadata. Nothing here knows about React, and the
 * property values are read from the same model the interpreter validates against, so the
 * grid cannot disagree with the engine.
 */

import type {
  AotObjectRef,
  AotObjectType,
  BaseEnumMetadata,
  DataEntityMetadata,
  EdtMetadata,
  FieldMetadata,
  FormMetadata,
  ReportMetadata,
  TableMetadata,
  VirtualAot,
} from "./types";

// ---------------------------------------------------------------------------
// The property grid
// ---------------------------------------------------------------------------

/**
 * The Properties window groups values into categories when the **Categorized** button is
 * pressed (VB-018).
 *
 * Only `Appearance` is sourced — the create-data-model-elements walkthrough sets an EDT's
 * Help Text, Label and String Size "in the **Appearance** section". The rest are our
 * reading of where the real product files them, and are logged in docs/unverified.md as
 * such. Getting a category wrong misplaces a row in a list; getting a property's *value*
 * wrong would be a fidelity failure, and those come from the model.
 */
export type PropertyCategory = "Appearance" | "Data" | "Behavior" | "General";

export interface PropertyValue {
  name: string;
  value: string;
  category: PropertyCategory;
  /**
   * `true` when the value differs from the AOT default, which is what the **Changed**
   * ordering divides on.
   */
  changed: boolean;
  /** Set when the value names another element, so the grid can offer "Go to <element>". */
  goTo?: AotObjectRef;
}

/** Orders the grid the way the buttons at the top of the Properties pane do (VB-018). */
export type PropertyOrdering = "Alphabetical" | "Categorized" | "Changed";

export interface PropertyGroup {
  label: string;
  properties: PropertyValue[];
}

/**
 * Arranges a property list for display.
 *
 * `Alphabetical` is one flat group, matching the real pane, which drops the headers
 * entirely in that mode.
 */
export function orderProperties(
  properties: readonly PropertyValue[],
  ordering: PropertyOrdering,
): PropertyGroup[] {
  const byName = (left: PropertyValue, right: PropertyValue): number =>
    left.name.localeCompare(right.name);

  if (ordering === "Alphabetical") {
    return [{ label: "", properties: [...properties].sort(byName) }];
  }

  if (ordering === "Changed") {
    const changed = properties.filter((property) => property.changed).sort(byName);
    const rest = properties.filter((property) => !property.changed).sort(byName);
    return [
      { label: "Changed", properties: changed },
      { label: "Default", properties: rest },
    ].filter((group) => group.properties.length > 0);
  }

  const categories: PropertyCategory[] = ["General", "Appearance", "Data", "Behavior"];
  return categories
    .map((category) => ({
      label: category,
      properties: properties.filter((property) => property.category === category).sort(byName),
    }))
    .filter((group) => group.properties.length > 0);
}

// ---------------------------------------------------------------------------
// Tree nodes
// ---------------------------------------------------------------------------

export type DesignerNodeKind =
  | "folder"
  | "element"
  | "field"
  | "fieldGroup"
  | "index"
  | "relation"
  | "method"
  | "enumValue"
  | "dataSource"
  | "control";

export interface DesignerNode {
  /** Stable path id, e.g. `InventTable/Fields/ItemId`. Used for selection and for tasks. */
  id: string;
  label: string;
  kind: DesignerNodeKind;
  children: DesignerNode[];
  /** What the Properties window shows while this node is selected. */
  properties: PropertyValue[];
  /** The element this node stands for, when it is one. Drives "Open designer". */
  ref?: AotObjectRef;
}

const node = (
  id: string,
  label: string,
  kind: DesignerNodeKind,
  properties: PropertyValue[] = [],
  children: DesignerNode[] = [],
): DesignerNode => ({ id, label, kind, properties, children });

// ---------------------------------------------------------------------------
// Application Explorer
// ---------------------------------------------------------------------------

/**
 * The AOT's top-level grouping, in the order and under the names the real tree uses
 * (VB-016). `Analytics` is listed because it is part of the tree a learner will see; ours
 * is empty, and the UI says so rather than hiding the node and teaching a shorter AOT
 * than the one that exists.
 */
const AOT_FOLDERS: { label: string; children: { label: string; type: AotObjectType }[] }[] = [
  {
    label: "Data Model",
    children: [
      { label: "Tables", type: "table" },
      { label: "Views", type: "view" },
      { label: "Data Entities", type: "dataEntity" },
    ],
  },
  {
    label: "Data Types",
    children: [
      { label: "Base Enums", type: "baseEnum" },
      { label: "Extended Data Types", type: "edt" },
    ],
  },
  { label: "Code", children: [{ label: "Classes", type: "class" }] },
  { label: "User Interface", children: [{ label: "Forms", type: "form" }] },
  { label: "Analytics", children: [{ label: "Reports", type: "report" }] },
];

/**
 * The whole model store, grouped by element type — Application Explorer's classic view.
 *
 * `filter` is the search box at the top of the pane. It matches on name, case-insensitively,
 * and empties the folders it does not match rather than hiding them, so the shape of the
 * tree stays legible while filtered.
 */
export function buildApplicationExplorer(aot: VirtualAot, filter = ""): DesignerNode {
  const needle = filter.trim().toLowerCase();
  const matches = (name: string): boolean => needle === "" || name.toLowerCase().includes(needle);

  const folders = AOT_FOLDERS.map((folder) =>
    node(
      `AOT/${folder.label}`,
      folder.label,
      "folder",
      [],
      folder.children.map((child) => {
        const elements = aot
          .listObjects(child.type)
          .filter((ref) => matches(ref.name))
          .map((ref) => ({
            ...node(`AOT/${folder.label}/${child.label}/${ref.name}`, ref.name, "element"),
            ref,
          }));

        return node(`AOT/${folder.label}/${child.label}`, child.label, "folder", [], elements);
      }),
    ),
  );

  return node("AOT", "AOT", "folder", [], folders);
}

// ---------------------------------------------------------------------------
// Element designers
// ---------------------------------------------------------------------------

/** Opens the designer for whatever element the ref names, or `undefined` if it has none. */
export function buildDesigner(aot: VirtualAot, ref: AotObjectRef): DesignerNode | undefined {
  switch (ref.type) {
    case "table": {
      const table = aot.getTable(ref.name);
      return table === undefined ? undefined : tableDesigner(aot, table);
    }
    case "edt": {
      const edt = aot.getEdt(ref.name);
      return edt === undefined ? undefined : edtDesigner(edt);
    }
    case "baseEnum": {
      const baseEnum = aot.getEnum(ref.name);
      return baseEnum === undefined ? undefined : enumDesigner(baseEnum);
    }
    case "form": {
      const form = aot.getForm(ref.name);
      return form === undefined ? undefined : formDesigner(form);
    }
    // A view opens on the same designer as a table. That is not a shortcut — a view is a
    // set of fields with a query behind it, and the designer differs by what it *lacks*:
    // no indexes of its own, and a Query property where a table has storage.
    case "view": {
      const view = aot.getTable(ref.name);
      return view === undefined ? undefined : tableDesigner(aot, view);
    }
    case "dataEntity": {
      const entity = aot.getEntity(ref.name);
      return entity === undefined ? undefined : entityDesigner(entity);
    }
    case "report": {
      const report = aot.getReport(ref.name);
      return report === undefined ? undefined : reportDesigner(report);
    }
    default:
      return undefined;
  }
}

/**
 * The data entity designer.
 *
 * Two things a learner needs to see here and nowhere else: the **two independent
 * switches** that decide which integration route can reach it, and the mapping from an
 * entity property to the `Table.Field` behind it — which is the whole abstraction, made
 * visible.
 */
function entityDesigner(entity: DataEntityMetadata): DesignerNode {
  const root = entity.name;

  return {
    ...node(
      root,
      entity.name,
      "element",
      [
        { name: "Name", value: entity.name, category: "General", changed: false },
        {
          name: "Public Collection Name",
          value: entity.publicCollectionName,
          category: "General",
          changed: true,
        },
        { name: "Entity Category", value: entity.category, category: "General", changed: true },
        {
          name: "Primary Data Source",
          value: entity.primaryTable,
          category: "Data",
          changed: true,
          goTo: { type: "table", name: entity.primaryTable },
        },
        // The two switches. Independent, and the reason "it's not on OData" almost never
        // means "it does not exist".
        {
          name: "Enable Public API",
          value: entity.isPublic ? "Yes" : "No",
          category: "Behavior",
          changed: !entity.isPublic,
        },
        {
          name: "Enable Data Management",
          value: entity.dataManagementEnabled ? "Yes" : "No",
          category: "Behavior",
          changed: !entity.dataManagementEnabled,
        },
      ],
      [
        node(
          `${root}/Fields`,
          "Fields",
          "folder",
          [],
          Object.entries(entity.mappings).map(([property, source]) =>
            node(`${root}/Fields/${property}`, property, "field", [
              { name: "Name", value: property, category: "General", changed: false },
              // The point of an entity in one row: the name the caller uses is not the
              // name the database uses.
              { name: "Maps To", value: source, category: "Data", changed: true },
            ]),
          ),
        ),
        node(
          `${root}/Data Sources`,
          "Data Sources",
          "folder",
          [],
          [entity.primaryTable, ...entity.joins.map((join) => join.table)].map((table) =>
            node(`${root}/Data Sources/${table}`, table, "dataSource", [
              {
                name: "Table",
                value: table,
                category: "Data",
                changed: true,
                goTo: { type: "table", name: table },
              },
              {
                name: "Role",
                value: table === entity.primaryTable ? "Primary" : "Joined",
                category: "General",
                changed: table !== entity.primaryTable,
              },
            ]),
          ),
        ),
      ],
    ),
    ref: { type: "dataEntity", name: entity.name },
  };
}

/**
 * The report designer.
 *
 * The grouping and totals live here rather than in the provider, and seeing them as
 * *properties* is what makes "the rows are right, the layout is wrong" a diagnosable
 * sentence rather than a shrug.
 */
function reportDesigner(report: ReportMetadata): DesignerNode {
  const root = report.name;

  return {
    ...node(
      root,
      report.name,
      "element",
      [
        { name: "Name", value: report.name, category: "General", changed: false },
        { name: "Title", value: report.title, category: "Appearance", changed: true },
      ],
      [
        node(
          `${root}/Datasets`,
          "Datasets",
          "folder",
          [],
          [
            node(`${root}/Datasets/${report.dataSetName}`, report.dataSetName, "dataSource", [
              { name: "Name", value: report.dataSetName, category: "General", changed: false },
              // The property the walkthrough has you set by hand, and the reason the
              // provider class is reachable from here at all.
              {
                name: "Data Source Type",
                value: "Report Data Provider",
                category: "Data",
                changed: true,
              },
              {
                name: "Query",
                value: report.dataProviderClass,
                category: "Data",
                changed: true,
              },
              { name: "Table", value: report.table, category: "Data", changed: true },
            ]),
          ],
        ),
        node(
          `${root}/Designs`,
          "Designs",
          "folder",
          [],
          [
            node(`${root}/Designs/${report.design}`, report.design, "control", [
              { name: "Name", value: report.design, category: "General", changed: false },
              {
                name: "Groupings",
                value: report.groupBy.join(", ") || "—",
                category: "Data",
                changed: report.groupBy.length > 0,
              },
              {
                name: "Totals",
                value:
                  report.totals.map((total) => `${total.aggregate}(${total.column})`).join(", ") ||
                  "—",
                category: "Data",
                changed: report.totals.length > 0,
              },
            ]),
          ],
        ),
      ],
    ),
    ref: { type: "report", name: report.name },
  };
}

/**
 * The table designer.
 *
 * The five child nodes are the ones a learner meets first and the ones the walkthroughs
 * use. A real table node also carries `Full Text Indexes`, `Delete Actions`, `State
 * Machines` and `Mappings`; we model none of those, and an empty node claiming otherwise
 * would be worse than its absence — the Studio names them in prose instead.
 */
function tableDesigner(aot: VirtualAot, table: TableMetadata): DesignerNode {
  const root = table.name;

  const fields = table.fields.map((field) =>
    node(`${root}/Fields/${field.name}`, field.name, "field", fieldProperties(aot, field)),
  );

  const groups = table.fieldGroups.map((group) =>
    node(
      `${root}/Field Groups/${group.name}`,
      group.name,
      "fieldGroup",
      [
        { name: "Name", value: group.name, category: "General", changed: false },
        { name: "Label", value: group.label, category: "Appearance", changed: true },
      ],
      group.fields.map((field) =>
        node(`${root}/Field Groups/${group.name}/${field}`, field, "field"),
      ),
    ),
  );

  const indexes = table.indexes.map((index) =>
    node(`${root}/Indexes/${index.name}`, index.name, "index", [
      { name: "Name", value: index.name, category: "General", changed: false },
      {
        name: "Allow Duplicates",
        value: index.allowDuplicates ? "Yes" : "No",
        category: "Data",
        changed: !index.allowDuplicates,
      },
      {
        name: "Fields",
        value: index.fields.join(", "),
        category: "Data",
        changed: true,
      },
    ]),
  );

  const relations = table.relations.map((relation) =>
    node(`${root}/Relations/${relation.name}`, relation.name, "relation", [
      { name: "Name", value: relation.name, category: "General", changed: false },
      {
        name: "Related Table",
        value: relation.relatedTable,
        category: "Data",
        changed: true,
        goTo: { type: "table", name: relation.relatedTable },
      },
      {
        name: "Fields",
        value: relation.fields
          .map((pair) => `${pair.field} = ${relation.relatedTable}.${pair.relatedField}`)
          .join(", "),
        category: "Data",
        changed: true,
      },
    ]),
  );

  const methods = table.methods.map((method) =>
    node(`${root}/Methods/${method.name}`, method.name, "method", [
      { name: "Name", value: method.name, category: "General", changed: false },
      { name: "Return Type", value: method.returnType, category: "Data", changed: true },
      {
        name: "Is Display Method",
        value: method.isDisplay ? "Yes" : "No",
        category: "Behavior",
        changed: method.isDisplay,
      },
    ]),
  );

  return {
    ...node(root, table.name, "element", tableProperties(table), [
      node(`${root}/Fields`, "Fields", "folder", [], fields),
      node(`${root}/Field Groups`, "Field Groups", "folder", [], groups),
      node(`${root}/Indexes`, "Indexes", "folder", [], indexes),
      node(`${root}/Relations`, "Relations", "folder", [], relations),
      node(`${root}/Methods`, "Methods", "folder", [], methods),
    ]),
    ref: { type: "table", name: table.name },
  };
}

function tableProperties(table: TableMetadata): PropertyValue[] {
  const primary = table.indexes.find((index) => index.primary);

  return [
    { name: "Name", value: table.name, category: "General", changed: false },
    { name: "Label", value: table.label, category: "Appearance", changed: true },
    {
      name: "Save Data Per Company",
      value: table.saveDataPerCompany ? "Yes" : "No",
      category: "Data",
      // `Yes` is the default, so a shared table is the one showing a changed value — and
      // that is exactly the property the companies lesson is about.
      changed: !table.saveDataPerCompany,
    },
    {
      name: "Primary Index",
      value: primary?.name ?? "",
      category: "Data",
      changed: primary !== undefined,
    },
  ];
}

/**
 * A field's properties.
 *
 * `Extended Data Type` carries a `goTo`, because "right-click a field and jump to the EDT
 * it is based on" is how a developer actually reads an unfamiliar table, and the real
 * designer offers exactly that as **Go to <element>** (VB-018 source).
 */
function fieldProperties(aot: VirtualAot, field: FieldMetadata): PropertyValue[] {
  const properties: PropertyValue[] = [
    { name: "Name", value: field.name, category: "General", changed: false },
    {
      name: "Label",
      value: field.label,
      category: "Appearance",
      changed: field.label !== field.name,
    },
    {
      name: "Mandatory",
      value: field.mandatory ? "Yes" : "No",
      category: "Data",
      changed: field.mandatory,
    },
    {
      name: "Allow Edit",
      value: field.allowEdit ? "Yes" : "No",
      category: "Behavior",
      changed: !field.allowEdit,
    },
  ];

  if (field.edt !== undefined) {
    const edt = aot.getEdt(field.edt);
    properties.push({
      name: "Extended Data Type",
      value: field.edt,
      category: "Data",
      changed: true,
      goTo: { type: "edt", name: field.edt },
    });
    // The string size comes from the EDT rather than the field, which is the reason to
    // use an EDT at all. Showing where it came from is the lesson.
    if (edt?.stringSize !== undefined) {
      properties.push({
        name: "String Size",
        value: `${edt.stringSize} (from ${edt.name})`,
        category: "Data",
        changed: false,
      });
    }
  }

  if (field.enumName !== undefined) {
    properties.push({
      name: "Enum Type",
      value: field.enumName,
      category: "Data",
      changed: true,
      goTo: { type: "baseEnum", name: field.enumName },
    });
  }

  return properties;
}

function edtDesigner(edt: EdtMetadata): DesignerNode {
  return {
    ...node(edt.name, edt.name, "element", [
      { name: "Name", value: edt.name, category: "General", changed: false },
      {
        name: "Label",
        value: edt.label ?? "",
        category: "Appearance",
        changed: edt.label !== undefined,
      },
      {
        name: "Help Text",
        value: edt.helpText ?? "",
        category: "Appearance",
        changed: edt.helpText !== undefined,
      },
      {
        name: "String Size",
        value: edt.stringSize === undefined ? "" : String(edt.stringSize),
        category: "Data",
        changed: edt.stringSize !== undefined,
      },
      {
        name: "Extends",
        value: edt.extendsEdt ?? "",
        category: "Data",
        changed: edt.extendsEdt !== undefined,
      },
    ]),
    ref: { type: "edt", name: edt.name },
  };
}

function enumDesigner(baseEnum: BaseEnumMetadata): DesignerNode {
  return {
    ...node(
      baseEnum.name,
      baseEnum.name,
      "element",
      [{ name: "Name", value: baseEnum.name, category: "General", changed: false }],
      baseEnum.values.map((value) =>
        node(`${baseEnum.name}/${value.name}`, value.name, "enumValue", [
          { name: "Name", value: value.name, category: "General", changed: false },
          { name: "Label", value: value.label, category: "Appearance", changed: true },
          // The stored number is the point: an enum column holds this, not the label, and
          // a learner who has not seen it will not understand `Blocked == 1` in a trace.
          { name: "Enum Value", value: String(value.value), category: "Data", changed: false },
        ]),
      ),
    ),
    ref: { type: "baseEnum", name: baseEnum.name },
  };
}

function formDesigner(form: FormMetadata): DesignerNode {
  const controls = (control: FormMetadata["design"], path: string): DesignerNode =>
    node(
      `${path}/${control.name}`,
      control.name,
      "control",
      [
        { name: "Name", value: control.name, category: "General", changed: false },
        { name: "Type", value: control.type, category: "General", changed: false },
        ...(control.dataSource === undefined
          ? []
          : [
              {
                name: "Data Source",
                value: control.dataSource,
                category: "Data" as const,
                changed: true,
              },
            ]),
        ...(control.dataField === undefined
          ? []
          : [
              {
                name: "Data Field",
                value: control.dataField,
                category: "Data" as const,
                changed: true,
              },
            ]),
      ],
      control.children.map((child) => controls(child, `${path}/${control.name}`)),
    );

  return {
    ...node(
      form.name,
      form.name,
      "element",
      [
        { name: "Name", value: form.name, category: "General", changed: false },
        { name: "Caption", value: form.caption, category: "Appearance", changed: true },
        { name: "Pattern", value: form.pattern, category: "General", changed: true },
      ],
      [
        node(
          `${form.name}/Data Sources`,
          "Data Sources",
          "folder",
          [],
          form.dataSources.map((source) =>
            node(`${form.name}/Data Sources/${source.name}`, source.name, "dataSource", [
              { name: "Name", value: source.name, category: "General", changed: false },
              {
                name: "Table",
                value: source.table,
                category: "Data",
                changed: true,
                goTo: { type: "table", name: source.table },
              },
              {
                name: "Allow Edit",
                value: source.allowEdit ? "Yes" : "No",
                category: "Behavior",
                changed: !source.allowEdit,
              },
            ]),
          ),
        ),
        controls(form.design, form.name),
      ],
    ),
    ref: { type: "form", name: form.name },
  };
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

/** Depth-first lookup by node id. */
export function findNode(root: DesignerNode, id: string): DesignerNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}
