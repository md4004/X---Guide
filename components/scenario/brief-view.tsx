"use client";

/**
 * The brief: somebody asking you for something, in bubbles.
 *
 * Two deliberate choices about how this reads.
 *
 * **Their bubbles are plain and yours are not.** What a functional consultant says is
 * just what they said — it is not a puzzle with a right answer hidden in it. What *you*
 * say is a choice, and after you make it the margin tells you what that choice cost or
 * saved. That asymmetry is the lesson: you cannot control what you are told, only what
 * you ask.
 *
 * **Nothing is ever wrong enough to stop you.** Every reply advances. A weak one leaves a
 * requirement vague, and you find out in the build phase, which is exactly how it happens
 * on a real project — nobody tells you at the time that you failed to ask.
 */

import { useEffect, useRef } from "react";
import type { BriefState, ScenarioDefinition, Speaker } from "@xpplab/scenarios";
import { awaitingReply, visibleTurns } from "@xpplab/scenarios";

export function BriefView({
  scenario,
  state,
  onReply,
  onAdvance,
}: {
  scenario: ScenarioDefinition;
  state: BriefState;
  onReply: (choiceId: string) => void;
  onAdvance: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const shown = visibleTurns(scenario, state);
  const waiting = awaitingReply(scenario, state);

  // Follow the conversation down as it grows, the way a chat does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.turn, state.choices.length, state.closed]);

  const cast = new Map<string, Speaker>(scenario.cast.map((speaker) => [speaker.id, speaker]));

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 py-6" data-testid="conversation">
        <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500">
          A worked conversation, written by us. The people are invented; the way the
          requirement arrives is not.
        </p>

        {scenario.conversation.slice(0, shown).map((turn, index) => {
          const speaker = cast.get(turn.speaker);
          const previous = scenario.conversation[index - 1];
          const isFirstOfRun = previous?.speaker !== turn.speaker;
          const taken = turn.choices?.find((choice) => state.choices.includes(choice.id));

          return (
            <div key={index} className="space-y-4">
              <Bubble speaker={speaker} showSpeaker={isFirstOfRun} text={turn.text} />

              {taken !== undefined && (
                <>
                  <Bubble mine text={taken.text} />
                  <Bubble speaker={speaker} showSpeaker={false} text={taken.response} />
                  <p
                    data-testid="choice-note"
                    className="ml-auto max-w-[85%] border-l-2 border-amber-500/40 pl-3 text-xs leading-relaxed text-amber-200/80"
                  >
                    {taken.note}
                  </p>
                </>
              )}

              {index === state.turn && waiting && (
                <div className="space-y-2 pt-1" data-testid="choices">
                  <p className="text-right font-mono text-[11px] tracking-widest text-zinc-600 uppercase">
                    You say
                  </p>
                  {turn.choices?.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      data-testid={`choice-${choice.id}`}
                      onClick={() => onReply(choice.id)}
                      className="ml-auto block w-full max-w-[85%] rounded-lg rounded-br-sm border border-sky-500/40 bg-sky-500/5 px-4 py-2.5 text-left text-sm text-sky-100 transition hover:border-sky-400 hover:bg-sky-500/15"
                    >
                      {choice.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {state.closed && (
          <p
            data-testid="brief-closed"
            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            That is the brief. Check the requirements on the right — anything you did not
            pin down in the conversation is marked, and you are about to find out why that
            matters.
          </p>
        )}

        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-6 py-3">
        <button
          type="button"
          onClick={onAdvance}
          disabled={waiting || state.closed}
          data-testid="brief-continue"
          className="rounded bg-sky-500 px-5 py-2 text-sm font-medium text-sky-950 transition hover:bg-sky-400 disabled:opacity-30"
        >
          {waiting ? "Answer them first" : state.closed ? "Brief finished" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function Bubble({
  speaker,
  showSpeaker = true,
  text,
  mine = false,
}: {
  speaker?: Speaker;
  showSpeaker?: boolean;
  text: string;
  mine?: boolean;
}) {
  if (mine) {
    return (
      <div className="ml-auto max-w-[85%]">
        <div className="rounded-lg rounded-br-sm bg-sky-500/20 px-4 py-2.5 text-sm leading-relaxed text-sky-50">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[85%] gap-3">
      <div
        aria-hidden
        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${
          showSpeaker ? "bg-zinc-700 text-zinc-200" : "invisible"
        }`}
      >
        {speaker?.initials ?? "??"}
      </div>
      <div className="min-w-0">
        {showSpeaker && speaker !== undefined && (
          <p className="mb-1 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{speaker.name}</span>
            <span className="mx-1.5 text-zinc-700">·</span>
            {speaker.role}
          </p>
        )}
        <div className="rounded-lg rounded-tl-sm bg-zinc-800/80 px-4 py-2.5 text-sm leading-relaxed text-zinc-100">
          {text}
        </div>
      </div>
    </div>
  );
}
