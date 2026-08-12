"use client";

/**
 * What happened when you ran the code, under the editor.
 *
 * One message, never a list. Which message depends on how far the code got: it did not
 * parse, it failed at runtime, or it ran and did the wrong thing. The Infolog and the SQL
 * trace sit behind tabs so the panel stays short — but the SQL is one click away on every
 * step, because reading it is half of what this teaches.
 */

import { useState } from "react";
import type { TaskOutcome } from "@/lib/run-protocol";
import { InfologPanel, SqlTracePanel } from "@/components/playground/panels";
import { FormView } from "@/components/renderers/form-view";
import { ReportView } from "@/components/renderers/report-view";

type Tab = "result" | "infolog" | "sql" | "view";

export function ResultPanel({
  outcome,
  onSelectLine,
  actionLabel,
}: {
  outcome: TaskOutcome | undefined;
  onSelectLine: (line: number, column: number) => void;
  /**
   * What the button next to this panel actually says — "Check" on an exercise, "Run" on a
   * reading step. Telling someone to press Check while the button says Run is a small lie,
   * and it is the sort a learner blames themselves for.
   */
  actionLabel: string;
}) {
  const [selected, setSelected] = useState<Tab | undefined>(undefined);
  const [lastOutcome, setLastOutcome] = useState(outcome);

  const hasView =
    outcome?.form !== undefined ||
    outcome?.report !== undefined ||
    outcome?.viewError !== undefined;

  // Every new run drops the learner's tab choice, so the panel opens on whatever that run
  // is actually about. Adjusted during render rather than in an effect: an effect would
  // paint the old tab first and then visibly swap.
  if (outcome !== lastOutcome) {
    setLastOutcome(outcome);
    setSelected(undefined);
  }

  // A step that renders a form or a report wants it on screen, not behind a tab to hunt
  // for. Steps without one have no such tab, so this never hides the result.
  const tab: Tab = selected ?? (hasView ? "view" : "result");
  const setTab = setSelected;

  if (outcome === undefined) {
    return (
      <p className="px-4 py-3 text-xs text-zinc-600">
        Press {actionLabel}, or Ctrl/Cmd+Enter, to run your code.
      </p>
    );
  }

  const sqlCount = outcome.sqlTrace?.length ?? 0;
  const infologCount = outcome.infolog?.length ?? 0;
  const viewLabel = outcome.report === undefined ? "Form" : "Report";

  return (
    <div className="flex flex-col">
      <nav className="flex shrink-0 gap-1 border-b border-zinc-800 px-3">
        {(
          [
            ["result", outcome.passed && outcome.preview !== true ? "Passed" : "Result", 0],
            ...(hasView ? ([["view", viewLabel, 0]] as const) : []),
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
        {tab === "view" && (
          <>
            {outcome.form !== undefined && <FormView view={outcome.form} />}
            {outcome.report !== undefined && <ReportView view={outcome.report} />}
            {outcome.viewError !== undefined && (
              <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {outcome.viewError}
              </p>
            )}
          </>
        )}
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
  // A reading step's example is run, not judged, so it gets no verdict — only whatever
  // went wrong, if anything. Calling it "passed" would imply there was something to pass.
  if (outcome.preview === true) {
    const failure = outcome.parseErrors?.[0] ?? outcome.runtimeErrors?.[0];
    if (failure === undefined) {
      return (
        <p data-testid="example-ran" className="px-1 text-xs text-zinc-500">
          Ran. Look at the Infolog and the SQL trace — and change the code, nothing here is marked.
        </p>
      );
    }
  }

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
