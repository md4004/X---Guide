import { describe, expect, it } from "vitest";
import { buildFormView, buildReportView, handleODataRequest } from "@xpplab/renderers";
import type { ReportDataSet, ReportDesign } from "@xpplab/renderers";
import type { FormMetadata } from "@xpplab/virtual-aot";
import type { VirtualDb } from "@xpplab/virtual-db";

const emptyData: ReportDataSet = { columns: [], rows: [] };
const emptyDesign: ReportDesign = { title: "", groupBy: [], totals: [], pageSize: 50 };

describe("renderers contract", () => {
  it("declares the public surface but does not implement it yet", () => {
    expect(() => buildFormView({ metadata: {} as FormMetadata, db: {} as VirtualDb })).toThrowError(
      "not implemented",
    );
    expect(() => buildReportView(emptyData, emptyDesign)).toThrowError("not implemented");
    expect(() =>
      handleODataRequest(
        { method: "GET", entity: "Customers" },
        { entities: [], db: {} as VirtualDb },
      ),
    ).toThrowError("not implemented");
  });
});
