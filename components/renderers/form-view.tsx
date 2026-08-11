"use client";

/**
 * A form, drawn from its view model.
 *
 * Shaped after an F&O form — caption, fast tabs, a grid — without pretending to be one.
 * The badge in the header says so, because a learner who thinks they are looking at the
 * real client will draw wrong conclusions about everything it does not do.
 */

import type { FormViewModel, GridViewModel, FastTabViewModel } from "@xpplab/renderers";

export function FormView({ view }: { view: FormViewModel }) {
  return (
    <div className="flex flex-col gap-3" data-testid="form-view">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-2">
        <h3 className="text-sm font-medium text-zinc-100">{view.caption}</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {view.name}
        </span>
        <span className="font-mono text-[11px] text-zinc-600">
          {view.table} · {view.rowCount} {view.rowCount === 1 ? "record" : "records"}
        </span>
        <span
          title="Rendered from metadata. It is not the F&O client, and it runs no form code."
          className="ml-auto rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
        >
          simulated
        </span>
      </header>

      {view.fastTabs.map((tab) => (
        <FastTab key={tab.name} tab={tab} />
      ))}

      {view.grid !== undefined && <Grid grid={view.grid} />}
    </div>
  );
}

function FastTab({ tab }: { tab: FastTabViewModel }) {
  return (
    <details open className="rounded border border-zinc-800 bg-zinc-900/40">
      <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-300">
        {tab.label}
        <span className="ml-2 font-mono text-[11px] text-zinc-600">{tab.summary.join(" · ")}</span>
      </summary>

      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1.5 px-3 pt-1 pb-3">
        {tab.fields.map((field) => (
          <div key={field.name} className="contents">
            <dt className="truncate text-xs text-zinc-500">
              {field.label}
              {field.mandatory && (
                <span title="Mandatory" className="ml-1 text-rose-400">
                  *
                </span>
              )}
            </dt>
            <dd
              className={`truncate font-mono text-xs ${
                field.editable ? "text-zinc-200" : "text-zinc-500 italic"
              }`}
              title={field.editable ? undefined : "Read-only in metadata"}
            >
              {field.display === "" ? "—" : field.display}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Grid({ grid }: { grid: GridViewModel }) {
  const changed = new Set(grid.changedRecIds);

  return (
    <div className="overflow-x-auto rounded border border-zinc-800">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="bg-zinc-900">
            {grid.columns.map((column) => (
              <th key={column.name} className="px-2 py-1.5 font-medium text-zinc-400">
                {column.label}
                {column.mandatory && <span className="ml-1 text-rose-400">*</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr
              key={row.recId}
              className={changed.has(row.recId) ? "bg-emerald-500/10" : "odd:bg-zinc-900/30"}
            >
              {row.cells.map((cell, index) => (
                <td
                  key={grid.columns[index]?.name ?? index}
                  className="px-2 py-1 whitespace-nowrap text-zinc-300"
                >
                  {cell === "" ? "—" : cell}
                </td>
              ))}
            </tr>
          ))}

          {grid.rows.length === 0 && (
            <tr>
              <td colSpan={grid.columns.length} className="px-2 py-3 text-zinc-600">
                No records.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
