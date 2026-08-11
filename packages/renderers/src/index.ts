/**
 * @xpplab/renderers — view-model builders.
 *
 * These produce plain data structures. The React components in /components render them.
 * Nothing in this package imports React, which is what makes the form and report
 * renderers testable without a DOM.
 *
 *   form.ts    form metadata + a database -> the structure a form component draws
 *   report.ts  a data provider's dataset + a design -> grouped, totalled report rows
 *
 * The OData console is declared below and not implemented; it belongs to a later track.
 */

import type { SqlValue } from "@xpplab/xpp-core";
import type { DataEntityMetadata } from "@xpplab/virtual-aot";
import type { VirtualDb } from "@xpplab/virtual-db";

export { buildFormView } from "./form";
export type {
  BuildFormViewOptions,
  FastTabViewModel,
  FieldViewModel,
  FormViewModel,
  GridColumnViewModel,
  GridViewModel,
} from "./form";

export { buildReportView } from "./report";
export type {
  ReportColumn,
  ReportDataSet,
  ReportDesign,
  ReportGroupViewModel,
  ReportViewModel,
} from "./report";

// ---------------------------------------------------------------------------
// OData console (later track)
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
  throw new Error("The OData console arrives with the integration track.");
}
