"use client";

/**
 * The playground.
 *
 * Editor on the left, four result panels on the right. The engine runs entirely in a
 * worker, so this component never touches the interpreter directly — it posts a message
 * and renders what comes back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { PANEL_TABLES } from "@/lib/run-protocol";
import { useEngine, type RunOutcome } from "@/lib/use-engine";
import { permalinkUrl, readPermalinkFromLocation } from "@/lib/permalink";
import type { XppEditorHandle } from "./editor";
import { DataPanel, ErrorsPanel, InfologPanel, SqlTracePanel } from "./panels";

// Monaco touches `window` and `navigator` at import time, so it cannot be server
// rendered. This is the one place in the app that needs an ssr:false boundary.
const XppEditor = dynamic(() => import("./editor").then((module) => module.XppEditor), {
  ssr: false,
  loading: () => <span className="p-4 font-mono text-xs text-zinc-500">Loading the editor…</span>,
});

const STARTER = `// Block every furniture item, then say how many changed.
// Watch the SQL trace: this is one UPDATE per row.
InventTable inventTable;
int counter;

ttsbegin;
while select forupdate inventTable
    where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
ttscommit;

info(strFmt("Blocked %1 items", counter));
`;

type TabId = "infolog" | "data" | "sql" | "errors";

const TABS: { id: TabId; label: string }[] = [
  { id: "infolog", label: "Infolog" },
  { id: "data", label: "Data" },
  { id: "sql", label: "SQL trace" },
  { id: "errors", label: "Errors" },
];

/**
 * A permalink is read once, lazily, in the state initialiser rather than in an effect —
 * setting state from an effect on mount costs a second render before paint, and the
 * editor would visibly flash the starter snippet first.
 *
 * `window` is absent during the server render, so this returns the fallback there and
 * the real value on the client. That is safe here only because Monaco is behind an
 * `ssr: false` boundary, so the editor never renders on the server and there is nothing
 * to mismatch during hydration.
 */
function initialState<K extends "source" | "company">(key: K, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return readPermalinkFromLocation(window.location.hash)?.[key] ?? fallback;
}

export function Playground() {
  // Destructured so effects and callbacks depend on the individual stable functions
  // rather than on the whole hook result, which is a new object every render.
  const { busy, failure, run, reset, read } = useEngine();
  const [source, setSource] = useState(() => initialState("source", STARTER));
  const [company, setCompany] = useState(() => initialState("company", "HVND"));
  const [outcome, setOutcome] = useState<RunOutcome | undefined>();
  const [tab, setTab] = useState<TabId>("infolog");
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<XppEditorHandle | null>(null);

  // The mount effect reads the initial company without depending on it, so changing
  // company later does not re-trigger it.
  const companyRef = useRef(company);
  useEffect(() => {
    companyRef.current = company;
  }, [company]);

  // Load the Data panel before the first run, so it is never mysteriously empty. Also
  // doubles as the readiness signal — the Run button waits for this reply rather than
  // for a separate flag.
  useEffect(() => {
    void read(companyRef.current).then((result) => {
      if (result) setOutcome((current) => current ?? result);
    });
  }, [read]);

  const handleRun = useCallback(async () => {
    const result = await run(source, company);
    if (result === undefined) return;
    setOutcome(result);
    setCompany(result.company);
    // Jump to whichever panel has something to say. An error the learner has to hunt
    // for in another tab is an error they will not read.
    setTab(result.errors.length > 0 ? "errors" : "infolog");
  }, [run, source, company]);

  const handleReset = useCallback(async () => {
    const result = await reset();
    if (result === undefined) return;
    setOutcome(result);
    setTab("data");
  }, [reset]);

  const handleCompanyChange = useCallback(
    async (next: string) => {
      setCompany(next);
      const result = await read(next);
      if (result) setOutcome(result);
    },
    [read],
  );

  const handleShare = useCallback(async () => {
    const url = permalinkUrl(window.location.origin, window.location.pathname, {
      source,
      company,
    });
    window.history.replaceState(null, "", url);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [source, company]);

  const errorCount = outcome?.errors.length ?? 0;
  const companies = outcome?.companies ?? ["HVND"];

  const counts: Record<TabId, number> = {
    infolog: outcome?.infolog.length ?? 0,
    data: outcome?.tables.reduce((total, table) => total + table.changedRecIds.length, 0) ?? 0,
    sql: outcome?.sqlTrace.length ?? 0,
    errors: errorCount,
  };

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <span className="font-mono text-xs tracking-widest text-sky-400">X++Lab</span>
        <span className="text-sm text-zinc-500">Sandbox</span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Company
            <select
              value={company}
              onChange={(event) => void handleCompanyChange(event.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200"
            >
              {companies.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={busy}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            Reset data
          </button>

          <button
            type="button"
            onClick={() => void handleShare()}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            {copied ? "Link copied" : "Share"}
          </button>

          <button
            type="button"
            onClick={() => void handleRun()}
            // Enabled once the initial read has come back, which is the engine saying it
            // booted. No separate readiness flag to keep in sync.
            disabled={busy || outcome === undefined}
            data-testid="run"
            className="rounded bg-sky-500 px-4 py-1.5 text-xs font-medium text-sky-950 transition hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? "Running…" : "Run"}
          </button>
        </div>
      </header>

      {failure !== undefined && (
        <p className="shrink-0 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
          The engine failed: {failure}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="min-h-0 border-zinc-800 lg:border-r">
          <XppEditor
            value={source}
            onChange={setSource}
            onRun={() => void handleRun()}
            onReady={(handle) => {
              editorRef.current = handle;
            }}
          />
        </section>

        <section className="flex min-h-0 flex-col">
          <nav className="flex shrink-0 border-b border-zinc-800">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                data-testid={`tab-${entry.id}`}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs transition ${
                  tab === entry.id
                    ? "border-sky-400 text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {entry.label}
                {counts[entry.id] > 0 && (
                  <span
                    className={`rounded px-1.5 text-[10px] ${
                      entry.id === "errors"
                        ? "bg-rose-500/20 text-rose-300"
                        : "bg-zinc-700/50 text-zinc-400"
                    }`}
                  >
                    {counts[entry.id]}
                  </span>
                )}
              </button>
            ))}

            {outcome !== undefined && (
              <span className="ml-auto self-center px-4 font-mono text-[11px] text-zinc-600">
                {outcome.statementsExecuted} statements · {outcome.durationMs}ms
              </span>
            )}
          </nav>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tab === "infolog" && <InfologPanel entries={outcome?.infolog ?? []} />}
            {tab === "data" && <DataPanel tables={outcome?.tables ?? []} />}
            {tab === "sql" && <SqlTracePanel entries={outcome?.sqlTrace ?? []} />}
            {tab === "errors" && (
              <ErrorsPanel
                errors={outcome?.errors ?? []}
                onSelect={(line, column) => editorRef.current?.revealPosition(line, column)}
              />
            )}
          </div>
        </section>
      </div>

      <footer className="shrink-0 border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-600">
        Ctrl/Cmd+Enter to run. Showing {PANEL_TABLES.length} tables. Everything runs in your browser
        — nothing is sent to a server.
      </footer>
    </div>
  );
}
