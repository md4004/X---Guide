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
 *   odata.ts   a data entity + a request -> the JSON a client sees, and the SQL behind it
 */

export { MAX_PAGE_SIZE, ODataError, handleODataRequest, listPublicCollections } from "./odata";
export type { ODataContext, ODataRequest, ODataResponse } from "./odata";

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
