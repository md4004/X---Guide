"use client";

/**
 * A report, drawn from its view model.
 *
 * This is the *design* half of an F&O report: grouping, totals, a header. The learner
 * wrote the other half — the data provider — and the rows below are what it produced.
 *
 * It is not SSRS, and the badge says so. No page layout, no expressions, no subreports.
 */

import type { ReportGroupViewModel, ReportViewModel } from "@xpplab/renderers";
import type { Row } from "@xpplab/virtual-db";

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value) === "" ? "—" : String(value);
}

export function ReportView({ view }: { view: ReportViewModel }) {
  // System columns are noise, and a grouped-on column is already in the group header —
  // repeating it down every line is what makes a report read as a spreadsheet dump.
  const hidden = new Set(
    ["RECID", "DATAAREAID", ...view.groupBy].map((name) => name.toUpperCase()),
  );
  const columns = view.columns.filter((column) => !hidden.has(column.name.toUpperCase()));
  const totalColumns = Object.keys(view.grandTotals);

  return (
    <div className="flex flex-col gap-3" data-testid="report-view">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-2">
        <h3 className="text-sm font-medium text-zinc-100">{view.title}</h3>
        <span className="font-mono text-[11px] text-zinc-600">
          {view.rowCount} {view.rowCount === 1 ? "row" : "rows"} · {view.pageCount}{" "}
          {view.pageCount === 1 ? "page" : "pages"}
        </span>
        <span
          title="The grouping and totals a report design would apply. It is not SSRS."
          className="ml-auto rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
        >
          simulated
        </span>
      </header>

      {view.rowCount === 0 ? (
        <p className="rounded border border-zinc-800 px-3 py-4 text-xs text-zinc-500">
          The data provider returned no rows, so the report is empty. That is what a real one would
          print too.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {view.groups.map((group) => (
            <Group key={group.key.join("/")} group={group} columns={columns} depth={0} />
          ))}

          {view.groups.length === 0 && <Rows rows={view.rows} columns={columns} />}
        </div>
      )}

      {totalColumns.length > 0 && view.rowCount > 0 && (
        <footer className="flex flex-wrap gap-4 border-t border-zinc-800 pt-2">
          {totalColumns.map((column) => (
            <span key={column} className="font-mono text-xs text-zinc-300">
              <span className="text-zinc-500">Total {column}: </span>
              {format(view.grandTotals[column])}
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}

function Group({
  group,
  columns,
  depth,
}: {
  group: ReportGroupViewModel;
  columns: ReportViewModel["columns"];
  depth: number;
}) {
  return (
    <section
      className="rounded border border-zinc-800 bg-zinc-900/30"
      style={{ marginLeft: depth * 12 }}
    >
      <header className="flex flex-wrap items-baseline gap-3 px-3 py-1.5">
        <span className="text-xs font-medium text-zinc-200">{group.label}</span>
        {Object.entries(group.totals).map(([column, total]) => (
          <span key={column} className="font-mono text-[11px] text-zinc-500">
            {column} {format(total)}
          </span>
        ))}
      </header>

      {group.children.map((child) => (
        <Group key={child.key.join("/")} group={child} columns={columns} depth={depth + 1} />
      ))}

      {group.rows.length > 0 && (
        <div className="px-3 pb-2">
          <Rows rows={group.rows} columns={columns} />
        </div>
      )}
    </section>
  );
}

function Rows({ rows, columns }: { rows: Row[]; columns: ReportViewModel["columns"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.name} className="px-2 py-1 font-medium text-zinc-500">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="odd:bg-zinc-900/40">
              {columns.map((column) => (
                <td key={column.name} className="px-2 py-1 whitespace-nowrap text-zinc-300">
                  {format(row[column.name] ?? row[column.name.toUpperCase()])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
