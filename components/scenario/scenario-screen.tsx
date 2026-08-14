"use client";

/**
 * A scenario, end to end.
 *
 * Four phases in a fixed order, and you cannot skip one:
 *
 *   brief   — somebody asks you for something, in their words
 *   build   — the AOT and the editor, judged by the task's validators
 *   test    — the acceptance checks, named as cases, all of them shown
 *   release — dev → Asset library → UAT → sign-off → release candidate → production
 *
 * The requirement list is pinned to the right in every phase, because the whole argument
 * of a scenario is that the spec is a live document you keep going back to, not something
 * you read once.
 *
 * Build and test share one editor and one source. The distinction is what judges it: the
 * build phase tells you the first thing that is wrong so you can fix it, and the test
 * phase shows the whole list the way a UAT report would. Same code, two audiences.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  PHASE_ORDER,
  advance,
  createBriefState,
  createReleaseState,
  isBriefComplete,
  reply,
  requirementsFor,
  type ReleaseState,
  type ScenarioDefinition,
  type ScenarioPhase,
} from "@xpplab/scenarios";
import type { Validator } from "@xpplab/validators";
import { useEngine } from "@/lib/use-engine";
import type { TaskOutcome } from "@/lib/run-protocol";
import { ResultPanel } from "@/components/lesson/result-panel";
import { BriefView } from "./brief-view";
import { RequirementsPanel } from "./requirements-panel";
import { AotPanel, aotWorkComplete, type AotProgress } from "./aot-panel";
import { ReleaseBoard } from "./release-board";

const XppEditor = dynamic(
  () => import("@/components/playground/editor").then((module) => module.XppEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-xs text-zinc-600">
        Loading the editor…
      </div>
    ),
  },
);

const PHASE_TITLE: Record<ScenarioPhase, string> = {
  brief: "The brief",
  build: "Build it",
  test: "Prove it",
  release: "Ship it",
};

/** Attempts before the solution unlocks, matching a lesson. */
const ATTEMPTS_BEFORE_SOLUTION = 3;

export function ScenarioScreen({ scenario }: { scenario: ScenarioDefinition }) {
  const { busy, runTask, reset } = useEngine();

  const [phase, setPhase] = useState<ScenarioPhase>("brief");
  const [brief, setBrief] = useState(createBriefState);
  const [aotProgress, setAotProgress] = useState<AotProgress>({ done: [] });
  const [source, setSource] = useState(scenario.task.starter);
  const [outcome, setOutcome] = useState<TaskOutcome | undefined>();
  const [attempts, setAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [buildPassed, setBuildPassed] = useState(false);
  const [checkResults, setCheckResults] = useState<Record<string, boolean> | undefined>();
  const [release, setRelease] = useState<ReleaseState>(createReleaseState);
  const [finished, setFinished] = useState(false);
  const editorRef = useRef<{ revealPosition: (line: number, column: number) => void } | null>(null);

  // The scenario's own dataset. The default rows are deliberately small-value and nobody
  // in them is near a credit limit, so without this the exercise has nothing to bite on.
  useEffect(() => {
    void reset(scenario.seed);
  }, [reset, scenario.seed]);

  const requirements = useMemo(() => requirementsFor(scenario, brief), [scenario, brief]);
  const aotDone = aotWorkComplete(scenario.aotWork, aotProgress);

  const handleCheck = useCallback(async () => {
    const result = await runTask(scenario.task, source);
    if (result === undefined) return;

    setOutcome(result);
    setAttempts((current) => current + 1);
    if (result.passed) setBuildPassed(true);
  }, [runTask, scenario.task, source]);

  /**
   * The acceptance run.
   *
   * Every check is evaluated against **one** execution, because that is what an acceptance
   * test is: run the change once, look at everything it did. Running each check separately
   * would let a solution pass that only works when nothing else has happened yet.
   */
  const handleAcceptance = useCallback(async () => {
    const results: Record<string, boolean> = {};

    for (const check of scenario.acceptance) {
      const task = { ...scenario.task, validators: check.validators as Validator[] };
      const result = await runTask(task, source);
      results[check.id] = result?.passed === true;
      if (result !== undefined) setOutcome(result);
    }

    setCheckResults(results);
  }, [runTask, scenario.acceptance, scenario.task, source]);

  const allChecksPass =
    checkResults !== undefined && scenario.acceptance.every((check) => checkResults[check.id]);

  const canLeave: Record<ScenarioPhase, boolean> = {
    brief: isBriefComplete(brief),
    build: buildPassed && aotDone,
    test: allChecksPass,
    release: finished,
  };

  const phaseIndex = PHASE_ORDER.indexOf(phase);

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <Link href="/" className="font-mono text-xs tracking-widest text-sky-400">
          X++Lab
        </Link>
        <Link href="/scenarios" className="text-sm text-zinc-500 hover:text-zinc-300">
          Scenarios
        </Link>
        <span aria-hidden className="text-zinc-700">
          /
        </span>
        <span className="truncate text-sm text-zinc-200">{scenario.title}</span>

        <nav className="ml-auto flex items-center gap-1" data-testid="phase-rail">
          {PHASE_ORDER.map((candidate, index) => {
            const reached = index <= phaseIndex;
            return (
              <button
                key={candidate}
                type="button"
                data-testid={`phase-${candidate}`}
                data-active={candidate === phase}
                disabled={index > phaseIndex}
                onClick={() => setPhase(candidate)}
                className={`rounded px-2.5 py-1 text-xs transition disabled:cursor-not-allowed ${
                  candidate === phase
                    ? "bg-sky-500/20 text-sky-300"
                    : reached
                      ? "text-zinc-400 hover:bg-zinc-900"
                      : "text-zinc-700"
                }`}
              >
                {PHASE_TITLE[candidate]}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_minmax(300px,26%)]">
        <section className="flex min-h-0 flex-col border-zinc-800 lg:border-r">
          {phase === "brief" && (
            <BriefView
              scenario={scenario}
              state={brief}
              onReply={(choiceId) => setBrief((current) => reply(scenario, current, choiceId))}
              onAdvance={() => setBrief((current) => advance(scenario, current))}
            />
          )}

          {(phase === "build" || phase === "test") && (
            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(280px,30%)_1fr]">
              <div className="hidden min-h-0 border-r border-zinc-800 xl:block">
                <AotPanel
                  work={scenario.aotWork}
                  progress={aotProgress}
                  onProgress={setAotProgress}
                />
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="min-h-0 flex-1" data-testid="editor">
                  <XppEditor
                    value={source}
                    onChange={setSource}
                    onRun={() => void (phase === "build" ? handleCheck() : handleAcceptance())}
                    onReady={(handle) => {
                      editorRef.current = handle;
                    }}
                  />
                </div>

                <div className="max-h-[42%] shrink-0 overflow-auto border-t border-zinc-800">
                  {phase === "build" ? (
                    <ResultPanel
                      outcome={outcome}
                      actionLabel="Check"
                      onSelectLine={(line, column) =>
                        editorRef.current?.revealPosition(line, column)
                      }
                    />
                  ) : (
                    <AcceptancePanel scenario={scenario} results={checkResults} />
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === "release" && (
            <div className="min-h-0 flex-1 overflow-auto">
              <ReleaseBoard
                state={release}
                onState={setRelease}
                packageName={scenario.release.packageName}
                suggestedUpdateName={scenario.release.suggestedUpdateName}
                onFinished={() => setFinished(true)}
              />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
            <div>
              <p className="font-mono text-[11px] tracking-widest text-sky-400 uppercase">
                {PHASE_TITLE[phase]}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                You are the {scenario.yourRole}.
              </p>
            </div>

            {phase === "build" && (
              <BuildAside
                scenario={scenario}
                aotDone={aotDone}
                attempts={attempts}
                hintsShown={hintsShown}
                onHint={() => setHintsShown((current) => current + 1)}
                onUseSolution={() => setSource(scenario.task.solution)}
              />
            )}

            {phase === "test" && (
              <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
                These are the cases finance will run before they sign anything. Same code as
                the build phase — the difference is that you see all of them at once, the way
                a UAT report does, rather than the first thing that broke.
              </p>
            )}

            {phase === "release" && (
              <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
                The code is done. Now it has to travel, and the platform has opinions about
                how. Every refusal here names the rule behind it.
              </p>
            )}

            <RequirementsPanel requirements={requirements} phase={phase} />
          </div>

          <nav className="shrink-0 border-t border-zinc-800 px-4 py-3">
            {finished && phase === "release" ? (
              <div
                data-testid="scenario-finished"
                className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200"
              >
                <p className="font-medium">It is in production.</p>
                <p className="mt-1 text-xs text-emerald-300/80">
                  You took a sentence somebody said in a meeting, found the three things it
                  did not say, built it, proved it, and got it through the gates. That is the
                  job.
                </p>
                <Link
                  href="/scenarios"
                  className="mt-2 inline-block text-xs text-emerald-300 underline underline-offset-2"
                >
                  Back to scenarios
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {(phase === "build" || phase === "test") && (
                  <button
                    type="button"
                    onClick={() => void (phase === "build" ? handleCheck() : handleAcceptance())}
                    disabled={busy}
                    data-testid={phase === "build" ? "check" : "run-acceptance"}
                    className="rounded bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 transition hover:bg-sky-400 disabled:opacity-50"
                  >
                    {busy ? "Running…" : phase === "build" ? "Check" : "Run the tests"}
                  </button>
                )}

                <button
                  type="button"
                  data-testid="phase-next"
                  disabled={!canLeave[phase] || phase === "release"}
                  onClick={() => setPhase(PHASE_ORDER[phaseIndex + 1] ?? phase)}
                  className="ml-auto rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600"
                >
                  {phase === "release" ? "Finish it" : "Next →"}
                </button>
              </div>
            )}
          </nav>
        </aside>
      </div>
    </div>
  );
}

function AcceptancePanel({
  scenario,
  results,
}: {
  scenario: ScenarioDefinition;
  results: Record<string, boolean> | undefined;
}) {
  if (results === undefined) {
    return (
      <p className="px-4 py-3 text-xs text-zinc-600">
        Press <span className="text-zinc-400">Run the tests</span> to see how your change
        does against every case finance care about.
      </p>
    );
  }

  const passed = scenario.acceptance.filter((check) => results[check.id]).length;

  return (
    <div className="space-y-1.5 p-3" data-testid="acceptance-results">
      <p className="mb-2 font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
        {passed} of {scenario.acceptance.length} passing
      </p>
      {scenario.acceptance.map((check) => {
        const ok = results[check.id] === true;
        return (
          <div
            key={check.id}
            data-testid={`check-${check.id}`}
            data-passed={ok}
            className={`flex items-start gap-2 rounded px-2.5 py-1.5 text-xs ${
              ok ? "bg-emerald-500/5 text-emerald-200" : "bg-rose-500/5 text-rose-200"
            }`}
          >
            <span aria-hidden>{ok ? "✓" : "✗"}</span>
            <span>{check.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function BuildAside({
  scenario,
  aotDone,
  attempts,
  hintsShown,
  onHint,
  onUseSolution,
}: {
  scenario: ScenarioDefinition;
  aotDone: boolean;
  attempts: number;
  hintsShown: number;
  onHint: () => void;
  onUseSolution: () => void;
}) {
  const canReveal = attempts >= ATTEMPTS_BEFORE_SOLUTION;

  return (
    <div className="space-y-3">
      <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-sm leading-relaxed text-zinc-300">
        {scenario.task.prompt}
      </p>

      {!aotDone && (
        <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          The AOT work on the left is not finished. Your code can pass without it, but you
          cannot leave this phase until it is done — and one of those properties is the only
          place the enum name appears.
        </p>
      )}

      <div className="space-y-1.5">
        {scenario.task.hints.slice(0, hintsShown).map((hint, index) => (
          <p
            key={index}
            data-testid={`hint-${index}`}
            className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400"
          >
            {hint}
          </p>
        ))}

        {hintsShown < scenario.task.hints.length && (
          <button
            type="button"
            onClick={onHint}
            data-testid="hint"
            className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-900"
          >
            Show a hint
          </button>
        )}

        {canReveal && (
          <button
            type="button"
            onClick={onUseSolution}
            data-testid="use-solution"
            className="ml-2 rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-900"
          >
            Put the solution in the editor
          </button>
        )}
      </div>
    </div>
  );
}
