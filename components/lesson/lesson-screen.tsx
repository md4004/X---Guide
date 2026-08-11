"use client";

/**
 * Resolves a lesson by slug on the client, then renders its workspace.
 *
 * The registry lookup happens here rather than in the server page because the MDX
 * content is a *function* component, and a server component cannot pass a function to a
 * client one. The page passes two strings; this looks up everything else.
 *
 * The server page still imports the registry — it needs the frontmatter for metadata and
 * for `generateStaticParams` — but only ever hands strings across the boundary.
 */

import { getLesson, neighbours, track } from "@/content/tracks/xpp-fundamentals";
import { LessonWorkspace } from "./lesson-workspace";

export function LessonScreen({ lessonSlug }: { trackSlug: string; lessonSlug: string }) {
  const lesson = getLesson(lessonSlug);

  if (lesson === undefined) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-zinc-400">That lesson does not exist.</p>
      </main>
    );
  }

  const { previous, next } = neighbours(lessonSlug);

  return (
    <LessonWorkspace
      frontmatter={lesson.frontmatter}
      steps={lesson.steps}
      tasks={lesson.tasks}
      Content={lesson.Content}
      trackTitle={track.title}
      trackSlug={track.slug}
      {...(previous === undefined ? {} : { previous })}
      {...(next === undefined ? {} : { next })}
    />
  );
}
