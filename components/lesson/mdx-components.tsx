"use client";

/**
 * The components a lesson author can use in MDX.
 *
 * `<Step id="...">` is the structural one: the body of a lesson is a sequence of them,
 * and the workspace shows one at a time. Everything else is presentational.
 *
 * There is deliberately no comparison component here any more. The first version of this
 * track assumed the reader was arriving from Dynamics NAV and framed every concept as a
 * delta from C/AL, which reads as noise — or worse, as a prerequisite — to someone
 * arriving from C#, from SQL, or from nothing at all. Concepts are now explained on their
 * own terms, and `<Aside>` carries the "this will surprise you" material without assuming
 * where the surprise is coming from.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { MDXComponents } from "mdx/types";

const StepContext = createContext<{ activeStepId: string } | null>(null);

export function StepProvider({
  value,
  children,
}: {
  value: { activeStepId: string };
  children: ReactNode;
}) {
  return <StepContext.Provider value={value}>{children}</StepContext.Provider>;
}

/**
 * One step of the lesson.
 *
 * Every step is rendered into the tree and hides itself unless it is the active one,
 * which keeps authoring in plain MDX rather than splitting prose into a JS array.
 */
export function Step({ id, children }: { id: string; title?: string; children: ReactNode }) {
  const context = useContext(StepContext);
  if (context === null || context.activeStepId !== id) return null;
  return <div data-step={id}>{children}</div>;
}

/** Read-only illustrative code. Not runnable, and deliberately not an editor. */
export function Snippet({ children }: { lang?: string; children: ReactNode }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
      {children}
    </pre>
  );
}

/**
 * The "worth knowing" box.
 *
 * Used for the things that catch people out. Its title is authored per use rather than
 * fixed, because the surprises are not all of one kind.
 */
export function Aside({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <aside className="my-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
      <p className="mb-1.5 font-mono text-[10px] tracking-widest text-sky-400 uppercase">
        {title ?? "Worth knowing"}
      </p>
      <div className="flex flex-col gap-2 text-sm text-zinc-300">{children}</div>
    </aside>
  );
}

/** A short labelled table, for mapping concepts onto keywords. */
export function KeyPoints({ children }: { children: ReactNode }) {
  return <ul className="my-3 flex flex-col gap-1.5 text-sm text-zinc-300">{children}</ul>;
}

export const lessonComponents: MDXComponents = {
  Step,
  Snippet,
  Aside,
  KeyPoints,
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 className="mt-5 mb-2 text-base font-semibold text-zinc-100" {...props} />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3 className="mt-4 mb-1.5 text-sm font-semibold text-zinc-200" {...props} />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p className="my-2.5 text-sm leading-relaxed text-zinc-300" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-2.5 ml-5 list-disc text-sm text-zinc-300" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="my-2.5 ml-5 list-decimal text-sm text-zinc-300" {...props} />
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
  table: (props: React.ComponentProps<"table">) => (
    <div className="my-3 overflow-x-auto rounded border border-zinc-800">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th
      className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-left text-xs font-medium text-zinc-400"
      {...props}
    />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border-b border-zinc-900 px-3 py-1.5 text-zinc-300" {...props} />
  ),
};
