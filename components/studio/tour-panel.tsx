"use client";

/**
 * The guided tour, down the side of the Studio.
 *
 * Deliberately not a modal and not a wizard. It sits beside the real tool and ticks itself
 * off as you drive it, so nothing is ever gated and a learner who already knows Visual
 * Studio can ignore it entirely — or close it, and get the whole window back.
 */

import { Fragment, type ReactNode } from "react";
import { TOUR, currentTourStep, tourProgress, type StudioSnapshot } from "./tour";

/**
 * Renders `**bold**` and `` `code` `` in an instruction.
 *
 * The instructions name real commands — **Add to project**, `inventTable.update();` — and
 * those need to stand out from the prose around them or the learner has to parse a
 * sentence to find the thing to click. A full markdown pipeline for two constructs would
 * be absurd, so this is the two constructs.
 */
function formatted(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-medium text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-sky-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function TourPanel({
  snapshot,
  onClose,
}: {
  snapshot: StudioSnapshot;
  onClose: () => void;
}) {
  const done = tourProgress(snapshot);
  const current = currentTourStep(snapshot);

  return (
    <section
      className="flex w-72 min-w-0 flex-col border-l border-zinc-800 bg-zinc-950"
      data-testid="tour-panel"
    >
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-2 py-1">
        <h2 className="text-[11px] font-medium text-zinc-300">Guided tour</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500" data-testid="tour-progress">
            {done}/{TOUR.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the guided tour"
            className="text-zinc-600 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
      </header>

      {current === undefined ? (
        <p className="p-3 text-[11px] leading-relaxed text-emerald-300" data-testid="tour-complete">
          That is the whole tool. You have driven the AOT, a designer, the property grid, a build, a
          database synchronisation and the debugger — which between them is most of what a working
          day in Visual Studio actually consists of.
        </p>
      ) : (
        <div className="border-b border-zinc-800 p-3" data-testid="tour-current">
          <p className="font-mono text-[10px] tracking-widest text-sky-400">NEXT</p>
          <h3 className="mt-1 text-[12px] font-medium text-zinc-100">{current.title}</h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300">
            {formatted(current.instruction)}
          </p>
          <p className="mt-2 border-l-2 border-zinc-700 pl-2 text-[10px] leading-relaxed text-zinc-500">
            {current.why}
          </p>
        </div>
      )}

      <ol className="min-h-0 flex-1 overflow-auto p-2">
        {TOUR.map((step) => {
          const complete = step.done(snapshot);
          const isCurrent = step.id === current?.id;

          return (
            <li
              key={step.id}
              data-testid={`tour-step-${step.id}`}
              data-done={complete}
              className={`flex items-start gap-2 px-1 py-1 text-[11px] ${
                complete ? "text-zinc-600" : isCurrent ? "text-zinc-100" : "text-zinc-400"
              }`}
            >
              <span className={complete ? "text-emerald-400" : "text-zinc-700"}>
                {complete ? "✓" : "○"}
              </span>
              <span className={complete ? "line-through decoration-zinc-700" : ""}>
                {step.title}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
