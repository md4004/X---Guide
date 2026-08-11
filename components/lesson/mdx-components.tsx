"use client";

/**
 * The components a lesson author can use in MDX, per docs/lesson-schema.md.
 *
 * `<Task id="..." />` is the interesting one: the MDX body places tasks by id, and the
 * definitions live in the `tasks` export at the bottom of the same file. A context
 * carries them from the page to the placement, so an author edits one file and never
 * wires anything up.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import type { TaskDefinition } from "@xpplab/validators";
import { TaskBlock } from "./task";

interface LessonContextValue {
  lessonSlug: string;
  tasks: TaskDefinition[];
  onSolved: (taskId: string) => void;
}

const LessonContext = createContext<LessonContextValue | null>(null);

export function LessonProvider({
  value,
  children,
}: {
  value: LessonContextValue;
  children: ReactNode;
}) {
  return <LessonContext.Provider value={value}>{children}</LessonContext.Provider>;
}

/** Read-only illustrative code. Not runnable, and deliberately not an editor. */
export function Snippet({ children }: { lang?: string; children: ReactNode }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
      {children}
    </pre>
  );
}

/** Side-by-side C/AL and X++. The whole point of the track in one component. */
export function Compare({ cal, xpp }: { cal: string; xpp: string }) {
  return (
    <div className="my-6 grid gap-3 md:grid-cols-2">
      {[
        { label: "C/AL", code: cal, accent: "text-amber-400/70" },
        { label: "X++", code: xpp, accent: "text-sky-400/70" },
      ].map((side) => (
        <figure key={side.label} className="flex flex-col gap-1.5">
          <figcaption className={`font-mono text-[11px] tracking-wide ${side.accent}`}>
            {side.label}
          </figcaption>
          <pre className="flex-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
            {side.code}
          </pre>
        </figure>
      ))}
    </div>
  );
}

/**
 * The "how this differs from C/AL" box. Every lesson has exactly one, and the authoring
 * checklist in docs/lesson-schema.md says so.
 */
export function NavCallout({ children }: { children: ReactNode }) {
  return (
    <aside className="my-6 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <p className="mb-2 font-mono text-[11px] tracking-widest text-sky-400 uppercase">
        Coming from NAV
      </p>
      <div className="flex flex-col gap-2 text-sm text-zinc-300">{children}</div>
    </aside>
  );
}

export function Task({ id }: { id: string }) {
  const context = useContext(LessonContext);
  if (context === null) return null;

  const task = context.tasks.find((candidate) => candidate.id === id);
  if (task === undefined) {
    // An author typo should be loud. Rendering nothing would mean the task silently
    // vanishes from the lesson and nobody notices until a learner is confused.
    return (
      <p className="my-6 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
        Lesson authoring error: no task with id <code className="font-mono">{id}</code>. Available:{" "}
        {context.tasks.map((candidate) => candidate.id).join(", ") || "none"}.
      </p>
    );
  }

  return <TaskBlock task={task} lessonSlug={context.lessonSlug} onSolved={context.onSolved} />;
}

/** Everything MDX gets, in one object. */
export const lessonComponents: MDXComponents = {
  Snippet,
  Compare,
  NavCallout,
  Task,
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 className="mt-10 mb-3 text-xl font-semibold text-zinc-100" {...props} />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-200" {...props} />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p className="my-3 text-sm leading-relaxed text-zinc-300" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-3 ml-5 list-disc text-sm text-zinc-300" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => <li className="my-1" {...props} />,
  strong: (props: React.ComponentProps<"strong">) => (
    <strong className="font-semibold text-zinc-100" {...props} />
  ),
  em: (props: React.ComponentProps<"em">) => <em className="text-zinc-200 italic" {...props} />,
  code: (props: React.ComponentProps<"code">) => (
    <code
      className="rounded bg-zinc-800/70 px-1 py-0.5 font-mono text-[0.85em] text-sky-200"
      {...props}
    />
  ),
};
