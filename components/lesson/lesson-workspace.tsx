"use client";

/**
 * A lesson, as a workspace rather than a page.
 *
 * Editor on the left, instructions on the right, one step at a time. The learner reads
 * what to do, writes it, presses Check, and moves on with the arrow — which is a very
 * different thing from a long article with exercises buried in it. You are always either
 * reading the current instruction or writing the current answer, and never scrolling to
 * find out which.
 *
 * The whole MDX body is rendered on every step; each `<Step>` shows itself only when it
 * is the active one. That keeps authoring in ordinary MDX — no splitting prose into a
 * JavaScript array — at the cost of mounting some hidden markup, which for a lesson-sized
 * document is nothing.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import type { LessonFrontmatter, LessonStep, TaskDefinition } from "@xpplab/validators";
import { markSolved, useSolvedTasks } from "@/lib/progress";
import { useEngine } from "@/lib/use-engine";
import type { TaskOutcome } from "@/lib/run-protocol";
import { StepProvider, lessonComponents } from "./mdx-components";
import { ResultPanel } from "./result-panel";

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

export type MdxContent = ComponentType<MDXProps>;

/** Attempts before the solution unlocks, so nobody is ever stuck. */
const ATTEMPTS_BEFORE_SOLUTION = 3;

interface LessonWorkspaceProps {
  frontmatter: LessonFrontmatter;
  steps: LessonStep[];
  tasks: TaskDefinition[];
  Content: MdxContent;
  trackSlug: string;
  trackTitle: string;
  previous?: string;
  next?: string;
}

export function LessonWorkspace({
  frontmatter,
  steps,
  tasks,
  Content,
  trackSlug,
  trackTitle,
  previous,
  next,
}: LessonWorkspaceProps) {
  const { busy, runTask } = useEngine();

  const [index, setIndex] = useState(0);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, TaskOutcome>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [hintsShown, setHintsShown] = useState<Record<string, number>>({});
  const [solutionShown, setSolutionShown] = useState<Record<string, boolean>>({});
  const editorRef = useRef<{ revealPosition: (line: number, column: number) => void } | null>(null);

  const solved = useSolvedTasks(
    frontmatter.slug,
    tasks.map((task) => task.id),
  );

  const step = steps[index]!;
  const task = useMemo(
    () => (step.taskId === undefined ? undefined : tasks.find((t) => t.id === step.taskId)),
    [step.taskId, tasks],
  );

  const initialCode = task?.starter ?? step.example ?? "";
  const source = sources[step.id] ?? initialCode;
  const outcome = outcomes[step.id];
  const stepAttempts = attempts[step.id] ?? 0;

  const stepPassed =
    task === undefined || outcome?.passed === true || (task !== undefined && solved.has(task.id));

  const handleCheck = useCallback(async () => {
    if (task === undefined) return;
    const result = await runTask(task, source);
    if (result === undefined) return;

    setOutcomes((current) => ({ ...current, [step.id]: result }));
    setAttempts((current) => ({ ...current, [step.id]: (current[step.id] ?? 0) + 1 }));
    if (result.passed) markSolved(frontmatter.slug, task.id);
  }, [task, runTask, source, step.id, frontmatter.slug]);

  const goTo = useCallback(
    (target: number) => {
      setIndex(Math.max(0, Math.min(steps.length - 1, target)));
    },
    [steps.length],
  );

  const isLast = index === steps.length - 1;
  const canAdvance = stepPassed;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <Link href="/" className="font-mono text-xs tracking-widest text-sky-400">
          X++Lab
        </Link>
        <Link href={`/learn/${trackSlug}`} className="text-sm text-zinc-500 hover:text-zinc-300">
          {trackTitle}
        </Link>
        <span aria-hidden className="text-zinc-700">
          /
        </span>
        <span className="text-sm text-zinc-200">{frontmatter.title}</span>

        <div className="ml-auto flex items-center gap-3">
          <StepRail steps={steps} index={index} solved={solved} onSelect={goTo} />
          <span className="font-mono text-[11px] text-zinc-600">
            {index + 1} / {steps.length}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_minmax(380px,42%)]">
        {/* Left: the editor and its result. */}
        <section className="flex min-h-0 flex-col border-zinc-800 lg:border-r">
          <div className="min-h-0 flex-1">
            <XppEditor
              key={step.id}
              value={source}
              onChange={(value) => setSources((current) => ({ ...current, [step.id]: value }))}
              onRun={() => void handleCheck()}
              onReady={(handle) => {
                editorRef.current = handle;
              }}
            />
          </div>

          <div className="max-h-[38%] shrink-0 overflow-auto border-t border-zinc-800">
            <ResultPanel
              outcome={outcome}
              onSelectLine={(line, column) => editorRef.current?.revealPosition(line, column)}
            />
          </div>
        </section>

        {/* Right: what to do. */}
        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
            <p className="mb-1 font-mono text-[11px] tracking-widest text-sky-400 uppercase">
              Step {index + 1}
            </p>
            <h1 className="mb-4 text-lg font-semibold text-zinc-50">{step.title}</h1>

            <StepProvider value={{ activeStepId: step.id }}>
              <article className="lesson-prose">
                <Content components={lessonComponents} />
              </article>
            </StepProvider>

            {task !== undefined && (
              <TaskAside
                task={task}
                hintsShown={hintsShown[task.id] ?? 0}
                onHint={() =>
                  setHintsShown((current) => ({
                    ...current,
                    [task.id]: (current[task.id] ?? 0) + 1,
                  }))
                }
                solutionShown={solutionShown[task.id] === true}
                canRevealSolution={stepAttempts >= ATTEMPTS_BEFORE_SOLUTION}
                attemptsLeft={ATTEMPTS_BEFORE_SOLUTION - stepAttempts}
                onRevealSolution={() =>
                  setSolutionShown((current) => ({ ...current, [task.id]: true }))
                }
                onUseSolution={() =>
                  setSources((current) => ({ ...current, [step.id]: task.solution }))
                }
              />
            )}
          </div>

          <nav className="flex shrink-0 items-center gap-2 border-t border-zinc-800 px-6 py-3">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Previous step"
              data-testid="step-back"
              className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 disabled:opacity-30"
            >
              ←
            </button>

            {task !== undefined && (
              <button
                type="button"
                onClick={() => void handleCheck()}
                disabled={busy}
                data-testid="check"
                className="rounded bg-sky-500 px-5 py-2 text-sm font-medium text-sky-950 transition hover:bg-sky-400 disabled:opacity-50"
              >
                {busy ? "Checking…" : "Check"}
              </button>
            )}

            {isLast ? (
              next === undefined ? (
                <Link
                  href={`/learn/${trackSlug}`}
                  data-testid="step-next"
                  className={`ml-auto rounded px-4 py-2 text-sm font-medium transition ${
                    canAdvance
                      ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                      : "pointer-events-none bg-zinc-800 text-zinc-600"
                  }`}
                >
                  Finish lesson →
                </Link>
              ) : (
                <Link
                  href={`/learn/${trackSlug}/${next}`}
                  data-testid="step-next"
                  className={`ml-auto rounded px-4 py-2 text-sm font-medium transition ${
                    canAdvance
                      ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                      : "pointer-events-none bg-zinc-800 text-zinc-600"
                  }`}
                >
                  Next lesson →
                </Link>
              )
            ) : (
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={!canAdvance}
                aria-label="Next step"
                data-testid="step-next"
                className="ml-auto rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                Next →
              </button>
            )}
          </nav>
        </section>
      </div>
    </div>
  );
}

/** The dots along the top. Clickable backwards, so you can reread without losing place. */
function StepRail({
  steps,
  index,
  solved,
  onSelect,
}: {
  steps: LessonStep[];
  index: number;
  solved: Set<string>;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((step, position) => {
        const done = step.taskId !== undefined && solved.has(step.taskId);
        const reachable = position <= index || done;
        return (
          <li key={step.id}>
            <button
              type="button"
              title={step.title}
              aria-label={`Step ${position + 1}: ${step.title}`}
              disabled={!reachable}
              onClick={() => onSelect(position)}
              className={`h-2 w-6 rounded-full transition ${
                position === index
                  ? "bg-sky-400"
                  : done
                    ? "bg-emerald-500/70"
                    : reachable
                      ? "bg-zinc-600 hover:bg-zinc-500"
                      : "bg-zinc-800"
              }`}
            />
          </li>
        );
      })}
    </ol>
  );
}

/** Hints and the solution, under the instructions. */
function TaskAside({
  task,
  hintsShown,
  onHint,
  solutionShown,
  canRevealSolution,
  attemptsLeft,
  onRevealSolution,
  onUseSolution,
}: {
  task: TaskDefinition;
  hintsShown: number;
  onHint: () => void;
  solutionShown: boolean;
  canRevealSolution: boolean;
  attemptsLeft: number;
  onRevealSolution: () => void;
  onUseSolution: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-zinc-800 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        {hintsShown < task.hints.length && (
          <button
            type="button"
            onClick={onHint}
            data-testid="hint"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            {hintsShown === 0 ? "Show a hint" : `Next hint (${hintsShown}/${task.hints.length})`}
          </button>
        )}

        {canRevealSolution && !solutionShown && (
          <button
            type="button"
            onClick={onRevealSolution}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800"
          >
            Show the answer
          </button>
        )}

        {!canRevealSolution && attemptsLeft < 3 && (
          <span className="text-xs text-zinc-600">
            Answer unlocks after {attemptsLeft} more {attemptsLeft === 1 ? "try" : "tries"}
          </span>
        )}
      </div>

      {hintsShown > 0 && (
        <ol className="flex flex-col gap-1.5">
          {task.hints.slice(0, hintsShown).map((hint, position) => (
            <li
              key={hint}
              className="flex gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90"
            >
              <span className="text-amber-500/60">{position + 1}.</span>
              {hint}
            </li>
          ))}
        </ol>
      )}

      {solutionShown && (
        <div className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
            {task.solution}
          </pre>
          <button
            type="button"
            onClick={onUseSolution}
            className="self-start rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800"
          >
            Put it in the editor
          </button>
        </div>
      )}
    </div>
  );
}
