"use client";

/**
 * What you were asked for, as you currently understand it.
 *
 * Present in every phase, because that is the point: the spec is not a thing you read
 * once at the start. A requirement you pinned down by asking reads as a settled fact. One
 * you did not is marked — not to scold, but because "you found this out late" is a
 * different and more useful piece of information than "here is the spec".
 */

import type { KnownRequirement, ScenarioPhase } from "@xpplab/scenarios";

const PHASE_LABEL: Record<ScenarioPhase, string> = {
  brief: "brief",
  build: "build",
  test: "test",
  release: "release",
};

export function RequirementsPanel({
  requirements,
  phase,
}: {
  requirements: KnownRequirement[];
  phase: ScenarioPhase;
}) {
  const late = requirements.filter((requirement) => requirement.learnedLate).length;

  return (
    <div className="space-y-3" data-testid="requirements">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
          What they asked for
        </h2>
        {late > 0 && (
          <span className="font-mono text-[10px] text-amber-400/80">
            {late} learned late
          </span>
        )}
      </div>

      <ul className="space-y-2.5">
        {requirements.map((requirement) => (
          <li
            key={requirement.id}
            data-testid={`requirement-${requirement.id}`}
            className={`rounded border px-3 py-2.5 ${
              requirement.learnedLate
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-zinc-200">{requirement.summary}</p>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  requirement.satisfiedBy === phase
                    ? "bg-sky-500/20 text-sky-300"
                    : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {PHASE_LABEL[requirement.satisfiedBy]}
              </span>
            </div>

            {requirement.known ? (
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{requirement.detail}</p>
            ) : (
              <p className="mt-1.5 text-xs text-zinc-600 italic">
                Still vague. Nobody has said what this actually means.
              </p>
            )}

            {requirement.learnedLate && (
              <p className="mt-1.5 text-[11px] text-amber-300/70">
                You did not ask. This surfaced after the conversation was over — on a real
                project it surfaces after you have written the code.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
