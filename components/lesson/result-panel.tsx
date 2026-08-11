"use client";

/**
 * What happened when you pressed Check, under the editor.
 *
 * One message, never a list. Which message depends on how far the code got: it did not
 * parse, it failed at runtime, or it ran and did the wrong thing. The Infolog and the SQL
 * trace sit behind tabs so the panel stays short — but the SQL is one click away on every
 * step, because reading it is half of what this teaches.
 */

import { useState } from "react";
import type { TaskOutcome } from "@/lib/run-protocol";
import { InfologPanel, SqlTracePanel } from "@/components/playground/panels";

type Tab = "result" | "infolog" | "sql";

export function ResultPanel({
  outcome,
  onSelectLine,
}: {
  outcome: TaskOutcome | undefined;
  onSelectLine: (line: number, column: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("result");

  if (outcome === undefined) {
    return (
      <p className="px-4 py-3 text-xs text-zinc-600">
        Press Check, or Ctrl/Cmd+Enter, to run your code.
      </p>
    );
  }

  const sqlCount = outcome.sqlTrace?.length ?? 0;
  const infologCount = outcome.infolog?.length ?? 0;

  return (
    <div className="flex flex-col">
      <nav className="flex shrink-0 gap-1 border-b border-zinc-800 px-3">
        {(
          [
            ["result", outcome.passed ? "Passed" : "Result", 0],
            ["infolog", "Infolog", infologCount],
            ["sql", "SQL trace", sqlCount],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            data-testid={`result-tab-${id}`}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition ${
              tab === id
                ? "border-sky-400 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
            {count > 0 && (
              <span className="rounded bg-zinc-700/50 px-1.5 text-[10px] text-zinc-400">
                {count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-3">
        {tab === "result" && <Verdict outcome={outcome} onSelectLine={onSelectLine} />}
        {tab === "infolog" && <InfologPanel entries={outcome.infolog ?? []} />}
        {tab === "sql" && <SqlTracePanel entries={outcome.sqlTrace ?? []} />}
      </div>
    </div>
  );
}

function Verdict({
  outcome,
  onSelectLine,
}: {
  outcome: TaskOutcome;
  onSelectLine: (line: number, column: number) => void;
}) {
  if (outcome.passed) {
    return (
      <p
        data-testid="task-passed"
        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
      >
        That&apos;s it. Press Next to carry on.
      </p>
    );
  }

  const parseError = outcome.parseErrors?.[0];
  if (parseError !== undefined) {
    return (
      <button
        type="button"
        data-testid="task-failed"
        onClick={() => onSelectLine(parseError.line, parseError.column)}
        className="w-full rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left transition hover:bg-rose-500/15"
      >
        <p className="text-sm text-rose-300">
          <span className="font-mono text-xs opacity-70">line {parseError.line}</span>{" "}
          {parseError.message}
        </p>
        {parseError.hint !== undefined && (
          <p className="mt-1 text-xs text-zinc-400">{parseError.hint}</p>
        )}
      </button>
    );
  }

  const runtimeError = outcome.runtimeErrors?.[0];
  if (runtimeError !== undefined) {
    return (
      <div
        data-testid="task-failed"
        className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2"
      >
        <p className="text-sm text-rose-300">{runtimeError.message}</p>
        {runtimeError.hint !== undefined && (
          <p className="mt-1 text-xs text-zinc-400">{runtimeError.hint}</p>
        )}
      </div>
    );
  }

  return (
    <p
      data-testid="task-failed"
      className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      {outcome.message ?? "Not quite yet."}
    </p>
  );
}
