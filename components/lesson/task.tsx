"use client";

/**
 * One interactive task.
 *
 * The feedback rule from docs/lesson-schema.md drives the whole component: on failure a
 * learner sees **one** message, the authored one for the check that failed. Not a list,
 * not a diff of every assertion — a wall of red teaches nothing.
 *
 * Hints are progressive and opt-in. The solution unlocks only after enough real attempts
 * that revealing it is a mercy rather than a shortcut.
 */

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { TaskDefinition } from "@xpplab/validators";
import type { TaskOutcome } from "@/lib/run-protocol";
import { markSolved, useIsSolved } from "@/lib/progress";
import { useEngine } from "@/lib/use-engine";
import { SqlTracePanel } from "@/components/playground/panels";

const XppEditor = dynamic(
  () => import("@/components/playground/editor").then((module) => module.XppEditor),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse rounded bg-zinc-900" />,
  },
);

/** Attempts before the solution unlocks. Enough to have genuinely tried. */
const ATTEMPTS_BEFORE_SOLUTION = 3;

interface TaskProps {
  task: TaskDefinition;
  lessonSlug: string;
  onSolved?: (taskId: string) => void;
}

export function TaskBlock({ task, lessonSlug, onSolved }: TaskProps) {
  const { busy, runTask } = useEngine();
  const [source, setSource] = useState(task.starter);
  const [outcome, setOutcome] = useState<TaskOutcome | undefined>();
  const [attempts, setAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [solutionShown, setSolutionShown] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  // A pass recorded earlier, read through the store so revisiting a lesson does not
  // look like starting over — and without a mount effect that would flash the unsolved
  // state first.
  const solvedEarlier = useIsSolved(lessonSlug, task.id);

  const handleCheck = useCallback(async () => {
    const result = await runTask(task, source);
    if (result === undefined) return;

    setOutcome(result);
    setAttempts((count) => count + 1);

    if (result.passed) {
      markSolved(lessonSlug, task.id);
      onSolved?.(task.id);
    }
  }, [runTask, task, source, lessonSlug, onSolved]);

  const passed = outcome?.passed === true || (outcome === undefined && solvedEarlier);
  const canRevealSolution = solutionShown || attempts >= ATTEMPTS_BEFORE_SOLUTION;

  return (
    <section
      data-testid={`task-${task.id}`}
      className={`my-8 rounded-lg border ${passed ? "border-emerald-500/40" : "border-zinc-800"} bg-zinc-900/40`}
    >
      <header className="flex items-start gap-3 border-b border-zinc-800 px-4 py-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            passed ? "bg-emerald-500 text-emerald-950" : "bg-zinc-700 text-zinc-300"
          }`}
        >
          {passed ? "✓" : "?"}
        </span>
        <p className="text-sm text-zinc-200">{task.prompt}</p>
      </header>

      <div className="h-64 border-b border-zinc-800">
        <XppEditor value={source} onChange={setSource} onRun={() => void handleCheck()} />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={busy}
          data-testid={`check-${task.id}`}
          className="rounded bg-sky-500 px-4 py-1.5 text-xs font-medium text-sky-950 transition hover:bg-sky-400 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check"}
        </button>

        {hintsShown < task.hints.length && (
          <button
            type="button"
            onClick={() => setHintsShown((count) => count + 1)}
            data-testid={`hint-${task.id}`}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            {hintsShown === 0 ? "Hint" : `Next hint (${hintsShown}/${task.hints.length})`}
          </button>
        )}

        {canRevealSolution && !solutionShown && (
          <button
            type="button"
            onClick={() => setSolutionShown(true)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800"
          >
            Show solution
          </button>
        )}

        {!canRevealSolution && attempts > 0 && (
          <span className="text-xs text-zinc-600">
            Solution unlocks after {ATTEMPTS_BEFORE_SOLUTION - attempts} more{" "}
            {ATTEMPTS_BEFORE_SOLUTION - attempts === 1 ? "attempt" : "attempts"}
          </span>
        )}

        {outcome?.sqlTrace !== undefined && outcome.sqlTrace.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTrace((shown) => !shown)}
            className="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800"
          >
            {showTrace ? "Hide SQL" : `SQL trace (${outcome.sqlTrace.length})`}
          </button>
        )}
      </div>

      {hintsShown > 0 && (
        <ol className="flex flex-col gap-1.5 px-4 pb-3">
          {task.hints.slice(0, hintsShown).map((hint, index) => (
            <li
              key={hint}
              className="flex gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90"
            >
              <span className="text-amber-500/60">{index + 1}.</span>
              {hint}
            </li>
          ))}
        </ol>
      )}

      {outcome !== undefined ? (
        <Feedback outcome={outcome} />
      ) : (
        solvedEarlier && <Feedback outcome={{ passed: true, restored: true }} />
      )}

      {showTrace && outcome?.sqlTrace !== undefined && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <SqlTracePanel entries={outcome.sqlTrace} />
        </div>
      )}

      {solutionShown && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="mb-2 text-xs text-zinc-500">One way to write it:</p>
          <pre className="overflow-x-auto rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
            {task.solution}
          </pre>
          <button
            type="button"
            onClick={() => setSource(task.solution)}
            className="mt-2 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800"
          >
            Copy into the editor
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The feedback line.
 *
 * Exactly one message. Which one depends on how far the code got:
 *   - it did not parse → the parser's errors, which point at a line
 *   - it parsed but failed at runtime → the engine's error, which mirrors a real one
 *   - it ran but did the wrong thing → the authored validator message
 */
function Feedback({ outcome }: { outcome: TaskOutcome }) {
  if (outcome.passed) {
    return (
      <p
        data-testid="task-passed"
        className="border-t border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
      >
        {outcome.restored === true ? "Solved earlier — nice." : "That's it. Nicely done."}
      </p>
    );
  }

  const parseError = outcome.parseErrors?.[0];
  if (parseError !== undefined) {
    return (
      <div
        data-testid="task-failed"
        className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm"
      >
        <p className="text-rose-300">
          <span className="font-mono text-xs opacity-70">line {parseError.line}</span>{" "}
          {parseError.message}
        </p>
        {parseError.hint !== undefined && (
          <p className="mt-1 text-xs text-zinc-400">{parseError.hint}</p>
        )}
      </div>
    );
  }

  const runtimeError = outcome.runtimeErrors?.[0];
  if (runtimeError !== undefined) {
    return (
      <div
        data-testid="task-failed"
        className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm"
      >
        <p className="text-rose-300">{runtimeError.message}</p>
        {runtimeError.hint !== undefined && (
          <p className="mt-1 text-xs text-zinc-400">{runtimeError.hint}</p>
        )}
      </div>
    );
  }

  return (
    <p
      data-testid="task-failed"
      className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      {outcome.message ?? "Not quite yet."}
    </p>
  );
}
