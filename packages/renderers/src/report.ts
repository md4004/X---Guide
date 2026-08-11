/**
 * The report renderer's view model.
 *
 * An F&O report is two halves that meet at a temp table: a **report data provider** (RDP)
 * class, which is X++ and runs on the server, and a **design**, which is SSRS and is not.
 * The RDP's whole job is to fill a table with the rows the design will print.
 *
 * That split is what this models, and it is the single most useful thing to understand
 * about F&O reporting. The learner writes the data provider — real X++, real queries, a
 * real SQL trace — and this grouping-and-totalling pass stands in for what SSRS does with
 * the result.
 *
 * What this is not: SSRS. There is no page layout engine, no expression language, no
 * subreport, no rendering extension. The grouping and aggregation modelled here are the
 * parts a data provider has to understand in order to produce a sensible dataset; the
 * pixels are somebody else's problem, and pretending otherwise would be the kind of
 * plausible-but-wrong that this project exists to avoid.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { Row } from "@xpplab/virtual-db";

export interface ReportColumn {
  name: string;
  label: string;
  type: "str" | "int" | "real" | "date";
}

/** The temp-table output of a learner's report data provider. */
export interface ReportDataSet {
  columns: ReportColumn[];
  rows: Row[];
}

export interface ReportDesign {
  title: string;
  /** Column names to group on, outermost first. */
  groupBy: string[];
  totals: { column: string; aggregate: "sum" | "count" | "avg" }[];
  pageSize: number;
}

export interface ReportGroupViewModel {
  /** The grouped-on values, outermost first. */
  key: SqlValue[];
  label: string;
  /** Rows belonging directly to this group. Empty on a group that has children. */
  rows: Row[];
  totals: Record<string, number>;
  children: ReportGroupViewModel[];
}

export interface ReportViewModel {
  title: string;
  columns: ReportColumn[];
  header: { label: string; value: string }[];
  groups: ReportGroupViewModel[];
  /** Rows in report order, when the design groups on nothing. */
  rows: Row[];
  grandTotals: Record<string, number>;
  rowCount: number;
  pageCount: number;
}

function valueOf(row: Row, column: string): SqlValue {
  const key = Object.keys(row).find((name) => name.toLowerCase() === column.toLowerCase());
  return key === undefined ? null : row[key]!;
}

function numberOf(value: SqlValue): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregate(rows: Row[], totals: ReportDesign["totals"]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const total of totals) {
    const values = rows.map((row) => numberOf(valueOf(row, total.column)));

    switch (total.aggregate) {
      case "sum":
        result[total.column] = values.reduce((sum, value) => sum + value, 0);
        break;
      case "count":
        result[total.column] = values.length;
        break;
      case "avg":
        // A zero-row average is 0, not NaN. NaN on a report is a bug that reads as data.
        result[total.column] =
          values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
        break;
    }
  }

  return result;
}

/** Groups `rows` by `columns[depth]`, recursing while there are more levels. */
function group(
  rows: Row[],
  columns: string[],
  totals: ReportDesign["totals"],
  parentKey: SqlValue[],
): ReportGroupViewModel[] {
  const column = columns[0];
  if (column === undefined) return [];

  // A Map preserves first-seen order, so the report follows the order the data provider
  // returned rather than an alphabetical one nobody asked for.
  const buckets = new Map<string, { key: SqlValue; rows: Row[] }>();

  for (const row of rows) {
    const value = valueOf(row, column);
    const bucketKey = String(value);
    const bucket = buckets.get(bucketKey);
    if (bucket === undefined) {
      buckets.set(bucketKey, { key: value, rows: [row] });
    } else {
      bucket.rows.push(row);
    }
  }

  const rest = columns.slice(1);

  return [...buckets.values()].map((bucket) => {
    const key = [...parentKey, bucket.key];
    const children = rest.length === 0 ? [] : group(bucket.rows, rest, totals, key);

    return {
      key,
      label: String(bucket.key),
      // Rows hang off the innermost group only. A group that has children showing its
      // rows as well would print every row twice.
      rows: children.length === 0 ? bucket.rows : [],
      totals: aggregate(bucket.rows, totals),
      children,
    };
  });
}

export function buildReportView(data: ReportDataSet, design: ReportDesign): ReportViewModel {
  const missing = [...design.groupBy, ...design.totals.map((total) => total.column)].filter(
    (column) => !data.columns.some((entry) => entry.name.toLowerCase() === column.toLowerCase()),
  );

  if (missing.length > 0) {
    // Silently dropping an unknown column would produce a report that looks fine and
    // groups on nothing.
    throw new Error(
      `The design references ${missing.join(", ")}, which the data provider did not return.`,
    );
  }

  const groups =
    design.groupBy.length === 0 ? [] : group(data.rows, design.groupBy, design.totals, []);

  return {
    title: design.title,
    columns: data.columns,
    header: [],
    groups,
    rows: design.groupBy.length === 0 ? data.rows : [],
    grandTotals: aggregate(data.rows, design.totals),
    rowCount: data.rows.length,
    pageCount: Math.max(1, Math.ceil(data.rows.length / Math.max(1, design.pageSize))),
  };
}
