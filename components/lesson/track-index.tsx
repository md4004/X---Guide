"use client";

/**
 * The track page: what the track is, and where you are in it.
 *
 * Progress comes from the same store the lessons write to, so a lesson finished in
 * another tab shows here without a reload.
 */

import Link from "next/link";
import { useSolvedTasks } from "@/lib/progress";
import { lessons, orderedSlugs, track } from "@/content/tracks/xpp-for-nav-devs";

function LessonRow({ slug, index }: { slug: string; index: number }) {
  const lesson = lessons[slug]!;
  const solved = useSolvedTasks(
    slug,
    lesson.tasks.map((task) => task.id),
  );
  const complete = solved.size === lesson.tasks.length;

  return (
    <li>
      <Link
        href={`/learn/${track.slug}/${slug}`}
        className="flex items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900"
      >
        <span
          aria-hidden
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
            complete ? "bg-emerald-500 text-emerald-950" : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {complete ? "✓" : index + 1}
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-zinc-100">{lesson.frontmatter.title}</span>
          <span className="text-xs text-zinc-500">
            {lesson.frontmatter.objectives[0]}
            {lesson.frontmatter.objectives.length > 1 &&
              ` · +${lesson.frontmatter.objectives.length - 1} more`}
          </span>
        </span>

        <span className="ml-auto shrink-0 text-right font-mono text-[11px] text-zinc-600">
          <span className="block">{lesson.frontmatter.minutes} min</span>
          <span className="block">
            {solved.size}/{lesson.tasks.length} tasks
          </span>
        </span>
      </Link>
    </li>
  );
}

export function TrackIndex() {
  const slugs = orderedSlugs();
  const totalMinutes = slugs.reduce((total, slug) => total + lessons[slug]!.frontmatter.minutes, 0);
  const totalTasks = slugs.reduce((total, slug) => total + lessons[slug]!.tasks.length, 0);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[11px] tracking-widest text-sky-400">X++Lab</p>
        <h1 className="text-3xl font-semibold text-balance text-zinc-50">{track.title}</h1>
        <p className="text-pretty text-zinc-400">{track.summary}</p>
        <p className="font-mono text-xs text-zinc-600">
          {slugs.length} lessons · {totalTasks} validated tasks · about {totalMinutes} minutes
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {slugs.map((slug, index) => (
          <LessonRow key={slug} slug={slug} index={index} />
        ))}
      </ol>

      <p className="text-xs text-zinc-600">
        Everything runs in your browser. There is no account, and your progress is stored locally —
        clearing site data resets it.
      </p>
    </main>
  );
}
