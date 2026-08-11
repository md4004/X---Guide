"use client";

/**
 * A lesson page: objectives, prose with tasks embedded, and a progress footer.
 *
 * Progress lives in localStorage for now, keyed per lesson and task, which is what
 * PLAN.md asks for at this phase. Phase 11 moves it to an account.
 */

import { useCallback } from "react";
import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import type { LessonFrontmatter, TaskDefinition } from "@xpplab/validators";
import { useSolvedTasks } from "@/lib/progress";
import { LessonProvider, lessonComponents } from "./mdx-components";

/**
 * MDX content takes its component map as a prop rather than through `MDXProvider`.
 *
 * The provider evaluates `createContext` at module scope, which Next runs while
 * collecting page data on the server — where it is not a function. Passing the map
 * directly avoids the problem and drops a dependency.
 */
export type MdxContent = ComponentType<MDXProps>;

interface LessonViewProps {
  frontmatter: LessonFrontmatter;
  tasks: TaskDefinition[];
  Content: MdxContent;
  trackTitle: string;
}

export function LessonView({ frontmatter, tasks, Content, trackTitle }: LessonViewProps) {
  // Progress comes from a subscribable store rather than a mount effect: the page is
  // prerendered, so reading localStorage during render would break hydration, and
  // reading it in an effect would flash "0 of 3" before correcting itself.
  const solved = useSolvedTasks(
    frontmatter.slug,
    tasks.map((task) => task.id),
  );

  // Marking is the store's job; the TaskBlock writes and every subscriber re-renders.
  const handleSolved = useCallback(() => {}, []);

  const complete = solved.size === tasks.length && tasks.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex flex-col gap-3 border-b border-zinc-800 pb-8">
        <p className="font-mono text-[11px] tracking-widest text-sky-400">{trackTitle}</p>
        <h1 className="text-3xl font-semibold text-zinc-50">{frontmatter.title}</h1>

        <p className="text-xs text-zinc-500">
          About {frontmatter.minutes} minutes · {tasks.length} tasks
        </p>

        <section className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-2 font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
            By the end you will
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-zinc-300">
            {frontmatter.objectives.map((objective) => (
              <li key={objective} className="flex gap-2">
                <span aria-hidden className="text-zinc-600">
                  —
                </span>
                {objective}
              </li>
            ))}
          </ul>
        </section>
      </header>

      <LessonProvider value={{ lessonSlug: frontmatter.slug, tasks, onSolved: handleSolved }}>
        <article>
          <Content components={lessonComponents} />
        </article>
      </LessonProvider>

      <footer
        data-testid="lesson-progress"
        className={`mt-10 rounded-lg border p-4 text-sm ${
          complete
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-zinc-800 bg-zinc-900/40 text-zinc-400"
        }`}
      >
        {complete
          ? "Lesson complete. Every task validated."
          : `${solved.size} of ${tasks.length} tasks solved.`}
      </footer>
    </main>
  );
}
