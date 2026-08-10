/**
 * @xpplab/renderers — view-model builders.
 *
 * These produce plain data structures. The React components in /components render them.
 * Nothing in this package imports React, which is what makes the form and report
 * renderers testable without a DOM.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { FormMetadata, DataEntityMetadata } from "@xpplab/virtual-aot";
import type { Row, VirtualDb } from "@xpplab/virtual-db";

// ---------------------------------------------------------------------------
// Form renderer (Phase 7)
// ---------------------------------------------------------------------------

export interface FormViewModel {
  caption: string;
  actionPane: ActionPaneViewModel;
  /** F&O fast tabs, in design order. */
  fastTabs: FastTabViewModel[];
  grid?: GridViewModel;
}

export interface ActionPaneViewModel {
  tabs: { name: string; buttons: { name: string; label: string; enabled: boolean }[] }[];
}

export interface FastTabViewModel {
  name: string;
  label: string;
  expanded: boolean;
  /** Values shown in the collapsed header summary. */
  summary: string[];
  fields: FieldViewModel[];
}

export interface FieldViewModel {
  name: string;
  label: string;
  value: SqlValue;
  editable: boolean;
  mandatory: boolean;
  control: "string" | "int" | "real" | "date" | "combo" | "checkbox";
  /** Options for a combo bound to a base enum. */
  options?: { label: string; value: number }[];
  /** Set when a table extension added this field — the UI badges it. */
  fromExtension?: string;
}

export interface GridViewModel {
  columns: { name: string; label: string; width?: number }[];
  rows: Row[];
  /** RECIDs changed by the most recent run, for the highlight in Phase 4's Data panel. */
  changedRecIds: number[];
}

export interface BuildFormViewOptions {
  metadata: FormMetadata;
  db: VirtualDb;
  changedRecIds?: number[];
}

export function buildFormView(_options: BuildFormViewOptions): Promise<FormViewModel> {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Report renderer (Phase 9)
// ---------------------------------------------------------------------------

/** The temp-table output of a learner's report data provider. */
export interface ReportDataSet {
  columns: { name: string; label: string; type: "str" | "int" | "real" | "date" }[];
  rows: Row[];
}

export interface ReportDesign {
  title: string;
  groupBy: string[];
  totals: { column: string; aggregate: "sum" | "count" | "avg" }[];
  pageSize: number;
}

export interface ReportViewModel {
  title: string;
  header: { label: string; value: string }[];
  groups: ReportGroupViewModel[];
  grandTotals: Record<string, number>;
  pageCount: number;
}

export interface ReportGroupViewModel {
  /** The grouped-on values, outermost first. */
  key: SqlValue[];
  label: string;
  rows: Row[];
  totals: Record<string, number>;
  children: ReportGroupViewModel[];
}

export function buildReportView(_data: ReportDataSet, _design: ReportDesign): ReportViewModel {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// OData console (Phase 10)
// ---------------------------------------------------------------------------

export interface ODataRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Entity public collection name, e.g. `CustomersV3`. */
  entity: string;
  key?: Record<string, SqlValue>;
  query?: {
    select?: string[];
    filter?: string;
    top?: number;
    skip?: number;
    expand?: string[];
    orderby?: string[];
    count?: boolean;
  };
  body?: Record<string, SqlValue>;
}

export interface ODataResponse {
  status: number;
  /** The JSON payload, already shaped the way F&O shapes it (`@odata.context`, `value`). */
  body: unknown;
  /** The SQL the request generated — shown next to the JSON. That pairing is the lesson. */
  sql: { statement: string; parameters: SqlValue[] }[];
  error?: { code: string; message: string };
}

export interface ODataContext {
  entities: DataEntityMetadata[];
  db: VirtualDb;
}

export function handleODataRequest(
  _request: ODataRequest,
  _context: ODataContext,
): Promise<ODataResponse> {
  throw new Error("not implemented");
}
