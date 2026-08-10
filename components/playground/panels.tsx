"use client";

/**
 * The four result panels.
 *
 * Infolog, Data, SQL trace and Errors. Each is a plain presentational component over the
 * worker's reply — no fetching, no engine access. That keeps them trivially renderable
 * in a test and keeps the "no React below /components" rule pointing the right way.
 */

import type { InfologEntry, SqlTraceEntry, XppError } from "@xpplab/xpp-core";
import type { TableSnapshot } from "@/lib/run-protocol";

const EMPTY = "text-sm text-zinc-600 italic";

// ---------------------------------------------------------------------------
// Infolog
// ---------------------------------------------------------------------------

const INFOLOG_STYLES: Record<InfologEntry["type"], { icon: string; className: string }> = {
  info: { icon: "i", className: "text-sky-300 border-sky-500/30 bg-sky-500/5" },
  warning: { icon: "!", className: "text-amber-300 border-amber-500/30 bg-amber-500/5" },
  error: { icon: "x", className: "text-rose-300 border-rose-500/30 bg-rose-500/5" },
};

export function InfologPanel({ entries }: { entries: InfologEntry[] }) {
  if (entries.length === 0) {
    return <p className={EMPTY}>Nothing logged. Try `info(&quot;hello&quot;);`</p>;
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="infolog">
      {entries.map((entry) => {
        const style = INFOLOG_STYLES[entry.type];
        return (
          <li
            key={entry.sequence}
            className={`flex items-start gap-2 rounded border px-2 py-1 font-mono text-xs ${style.className}`}
          >
            <span aria-hidden className="mt-px w-3 shrink-0 text-center font-bold opacity-70">
              {style.icon}
            </span>
            <span className="whitespace-pre-wrap">{entry.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export function DataPanel({ tables }: { tables: TableSnapshot[] }) {
  const populated = tables.filter((table) => table.rows.length > 0);
  if (populated.length === 0) return <p className={EMPTY}>No rows in the visible tables.</p>;

  return (
    <div className="flex flex-col gap-6" data-testid="data-panel">
      {populated.map((table) => {
        const changed = new Set(table.changedRecIds);
        return (
          <section key={table.table} className="flex flex-col gap-1.5">
            <h3 className="flex items-baseline gap-2 font-mono text-xs text-zinc-400">
              {table.table}
              <span className="text-zinc-600">{table.rows.length} rows</span>
              {changed.size > 0 && (
                <span className="rounded bg-emerald-500/15 px-1.5 text-emerald-300">
                  {changed.size} changed
                </span>
              )}
            </h3>

            <div className="overflow-x-auto rounded border border-zinc-800">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="bg-zinc-900/70 text-left text-zinc-500">
                    {table.columns.map((column) => (
                      <th key={column} className="px-2 py-1 font-medium whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => {
                    const isChanged = changed.has(Number(row["RECID"]));
                    return (
                      <tr
                        key={String(row["RECID"] ?? index)}
                        // Rows this run touched are highlighted. Seeing *which* rows
                        // changed is most of what the panel is for.
                        className={
                          isChanged
                            ? "bg-emerald-500/10 text-emerald-200"
                            : "text-zinc-400 odd:bg-zinc-900/30"
                        }
                        data-changed={isChanged ? "true" : undefined}
                      >
                        {table.columns.map((column) => (
                          <td key={column} className="px-2 py-1 whitespace-nowrap">
                            {String(row[column] ?? "")}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SQL trace
// ---------------------------------------------------------------------------

const KIND_STYLES: Record<string, string> = {
  select: "bg-sky-500/15 text-sky-300",
  insert: "bg-emerald-500/15 text-emerald-300",
  update: "bg-amber-500/15 text-amber-300",
  delete: "bg-rose-500/15 text-rose-300",
  savepoint: "bg-violet-500/15 text-violet-300",
  release: "bg-violet-500/15 text-violet-300",
  rollback: "bg-violet-500/15 text-violet-300",
};

export function SqlTracePanel({ entries }: { entries: SqlTraceEntry[] }) {
  if (entries.length === 0) return <p className={EMPTY}>No SQL was generated.</p>;

  const statements = entries.filter(
    (entry) => !["savepoint", "release", "rollback"].includes(entry.kind),
  ).length;

  return (
    <div className="flex flex-col gap-2" data-testid="sql-trace">
      <p className="text-xs text-zinc-500">
        {entries.length} statements, {statements} of them data operations. A high count for a small
        change usually means row-by-row work that could be set-based.
      </p>

      <ol className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.sequence} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
              <span className="w-6 text-right text-zinc-600">{entry.sequence + 1}</span>
              <span
                className={`rounded px-1.5 py-0.5 ${KIND_STYLES[entry.kind] ?? "bg-zinc-700/30 text-zinc-300"}`}
              >
                {entry.kind}
              </span>
              <span className="text-zinc-500">{entry.rowCount} rows</span>
              {entry.transactionDepth > 0 && (
                <span className="text-zinc-600">ttsLevel {entry.transactionDepth}</span>
              )}
            </div>

            <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-zinc-300">
              {entry.sql}
            </pre>

            {entry.parameters.length > 0 && (
              <p className="mt-1 font-mono text-[11px] text-zinc-500">
                {entry.parameters.map((value) => JSON.stringify(value)).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function ErrorsPanel({
  errors,
  onSelect,
}: {
  errors: XppError[];
  onSelect: (line: number, column: number) => void;
}) {
  if (errors.length === 0) return <p className={EMPTY}>No errors.</p>;

  return (
    <ul className="flex flex-col gap-2" data-testid="errors">
      {errors.map((error, index) => (
        <li key={`${error.code}-${error.line}-${index}`}>
          <button
            type="button"
            onClick={() => onSelect(error.line, error.column)}
            className="w-full rounded border border-rose-500/30 bg-rose-500/5 p-2 text-left transition hover:bg-rose-500/10"
          >
            <span className="flex items-baseline gap-2 font-mono text-xs text-rose-300">
              <span className="rounded bg-rose-500/20 px-1.5">{error.code}</span>
              <span className="text-rose-400/70">
                line {error.line}, column {error.column}
              </span>
            </span>
            <p className="mt-1 text-sm text-zinc-200">{error.message}</p>
            {error.hint !== undefined && <p className="mt-1 text-xs text-zinc-400">{error.hint}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}
