/**
 * The form renderer's view model.
 *
 * Pure data in, pure data out. Takes form metadata and a database, produces the structure
 * a React component draws. Nothing here imports React, which is what lets the whole
 * renderer be tested without a DOM.
 *
 * The honest boundary: this renders a form's **data** and **layout**. It does not run a
 * form. There is no `element.args()`, no data source event chain, no lookup form, no
 * `super()`. A learner should come away understanding that a form is metadata over a
 * query — which is true and useful — and should not come away thinking they have written
 * form code, which they have not.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type {
  BaseEnumMetadata,
  FieldMetadata,
  FormControlMetadata,
  FormMetadata,
  VirtualAot,
} from "@xpplab/virtual-aot";
import type { Row, TableName, VirtualDb } from "@xpplab/virtual-db";

export interface FormViewModel {
  name: string;
  caption: string;
  pattern: FormMetadata["pattern"];
  /** The table the form's root data source reads. */
  table: string;
  /** How many rows the data source returned, before any paging. */
  rowCount: number;
  fastTabs: FastTabViewModel[];
  grid?: GridViewModel;
}

export interface FastTabViewModel {
  name: string;
  label: string;
  /** Values shown in the collapsed header summary. */
  summary: string[];
  fields: FieldViewModel[];
}

export interface FieldViewModel {
  name: string;
  label: string;
  value: SqlValue;
  /** What the value reads as on screen — an enum shows its label, not its number. */
  display: string;
  editable: boolean;
  mandatory: boolean;
  control: "string" | "int" | "real" | "date" | "combo" | "checkbox";
  /** Options for a combo bound to a base enum. */
  options?: { label: string; value: number }[];
  /** Set when a table extension added this field — the UI badges it. */
  fromExtension?: string;
}

export interface GridColumnViewModel {
  name: string;
  label: string;
  mandatory: boolean;
  editable: boolean;
  control: FieldViewModel["control"];
}

export interface GridViewModel {
  columns: GridColumnViewModel[];
  /** Already display-formatted: enums resolved, everything a string. */
  rows: { recId: number; cells: string[] }[];
  /** RECIDs changed by the most recent run, for the highlight. */
  changedRecIds: number[];
}

export interface BuildFormViewOptions {
  form: FormMetadata;
  aot: VirtualAot;
  db: VirtualDb;
  changedRecIds?: number[];
  /** Row to show in a Details-pattern form. Defaults to the first. */
  activeRecId?: number;
  limit?: number;
}

const RECID = "RECID";

/**
 * Metadata decides the control, exactly as it does in the AOT.
 *
 * Driven by the field's declared base type rather than by guessing from its name. A
 * renderer that inferred "this is called DeliveryDate so it is probably a date" would be
 * right often enough to hide the fact that it is wrong.
 */
function controlFor(field: FieldMetadata): FieldViewModel["control"] {
  if (field.enumName !== undefined) {
    // NoYes renders as a checkbox in F&O; every other enum gets a combo box.
    return field.enumName === "NoYes" ? "checkbox" : "combo";
  }

  switch (field.baseType) {
    case "int":
    case "int64":
      return "int";
    case "real":
      return "real";
    case "date":
    case "utcdatetime":
      return "date";
    default:
      return "string";
  }
}

function displayValue(
  value: SqlValue,
  field: FieldMetadata,
  baseEnum: BaseEnumMetadata | undefined,
): string {
  if (value === null || value === undefined) return "";

  if (field.enumName !== undefined && baseEnum !== undefined) {
    // An enum is stored as a number and shown as its label. Rendering the number would
    // be the single most misleading thing this component could do.
    const match = baseEnum.values.find((entry) => entry.value === Number(value));
    return match?.label ?? String(value);
  }

  if (value instanceof Uint8Array) return `<container, ${value.length} bytes>`;
  return String(value);
}

function collectBoundFields(control: FormControlMetadata): string[] {
  const here = control.dataField === undefined ? [] : [control.dataField];
  return [...here, ...control.children.flatMap(collectBoundFields)];
}

function findControls(
  control: FormControlMetadata,
  predicate: (control: FormControlMetadata) => boolean,
): FormControlMetadata[] {
  const here = predicate(control) ? [control] : [];
  return [...here, ...control.children.flatMap((child) => findControls(child, predicate))];
}

export async function buildFormView({
  form,
  aot,
  db,
  changedRecIds = [],
  activeRecId,
  limit = 100,
}: BuildFormViewOptions): Promise<FormViewModel> {
  const dataSource = form.dataSources[0];
  if (dataSource === undefined) {
    throw new Error(`Form ${form.name} declares no data source, so there is nothing to render.`);
  }

  const table = aot.getTable(dataSource.table);
  if (table === undefined) {
    throw new Error(
      `Form ${form.name} reads ${dataSource.table}, which is not in the metadata model.`,
    );
  }

  const rows = await db.readRows(dataSource.table as TableName, { limit });

  const field = (name: string): FieldMetadata | undefined =>
    table.fields.find((entry) => entry.name.toLowerCase() === name.toLowerCase());

  const enumFor = (metadata: FieldMetadata): BaseEnumMetadata | undefined =>
    metadata.enumName === undefined ? undefined : aot.getEnum(metadata.enumName);

  // ----- the grid, when the design has one -----
  const gridControl = findControls(form.design, (control) => control.type === "grid")[0];

  let grid: GridViewModel | undefined;
  if (gridControl !== undefined) {
    const columnFields = collectBoundFields(gridControl)
      .map(field)
      .filter((entry): entry is FieldMetadata => entry !== undefined);

    grid = {
      columns: columnFields.map((entry) => ({
        name: entry.name,
        label: entry.label,
        mandatory: entry.mandatory,
        editable: entry.allowEdit && dataSource.allowEdit,
        control: controlFor(entry),
      })),
      rows: rows.map((row) => ({
        recId: Number(row[RECID] ?? 0),
        cells: columnFields.map((entry) =>
          displayValue(valueOf(row, entry.name), entry, enumFor(entry)),
        ),
      })),
      changedRecIds,
    };
  }

  // ----- fast tabs, from the tabPages in the design -----
  const activeRow =
    activeRecId === undefined
      ? rows[0]
      : (rows.find((row) => Number(row[RECID] ?? 0) === activeRecId) ?? rows[0]);

  const fastTabs: FastTabViewModel[] = findControls(
    form.design,
    (control) => control.type === "tabPage",
  ).map((page) => {
    const pageFields = collectBoundFields(page)
      .map(field)
      .filter((entry): entry is FieldMetadata => entry !== undefined);

    const fields: FieldViewModel[] = pageFields.map((entry) => {
      const raw = activeRow === undefined ? null : valueOf(activeRow, entry.name);
      const baseEnum = enumFor(entry);

      return {
        name: entry.name,
        label: entry.label,
        value: raw,
        display: displayValue(raw, entry, baseEnum),
        editable: entry.allowEdit && dataSource.allowEdit,
        mandatory: entry.mandatory,
        control: controlFor(entry),
        ...(baseEnum === undefined
          ? {}
          : {
              options: baseEnum.values.map((value) => ({ label: value.label, value: value.value })),
            }),
        ...(entry.fromExtension === undefined ? {} : { fromExtension: entry.fromExtension }),
      };
    });

    return {
      name: page.name,
      label: page.label ?? page.name,
      // F&O shows the first couple of values in the collapsed header, so a user can scan
      // tabs without opening them.
      summary: fields.slice(0, 2).map((entry) => entry.display),
      fields,
    };
  });

  return {
    name: form.name,
    caption: form.caption,
    pattern: form.pattern,
    table: table.name,
    rowCount: rows.length,
    fastTabs,
    ...(grid === undefined ? {} : { grid }),
  };
}

/** Row keys come back in the database's casing; field names come from metadata. */
function valueOf(row: Row, fieldName: string): SqlValue {
  const key = Object.keys(row).find((name) => name.toLowerCase() === fieldName.toLowerCase());
  return key === undefined ? null : row[key]!;
}
