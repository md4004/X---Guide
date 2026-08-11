import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LessonScreen } from "@/components/lesson/lesson-screen";
import { getLesson, orderedSlugs, track } from "@/content/tracks/xpp-for-nav-devs";

/**
 * One track for now, so the route resolves against it directly. When a second track
 * lands this becomes a registry lookup — the shape is already right for it.
 */
function resolve(trackSlug: string, lessonSlug: string) {
  if (trackSlug !== track.slug) return undefined;
  const lesson = getLesson(lessonSlug);
  return lesson === undefined ? undefined : { lesson };
}

export function generateStaticParams() {
  return orderedSlugs().map((lesson) => ({ track: track.slug, lesson }));
}

export async function generateMetadata({
  params,
}: PageProps<"/learn/[track]/[lesson]">): Promise<Metadata> {
  const { track: trackSlug, lesson: lessonSlug } = await params;
  const resolved = resolve(trackSlug, lessonSlug);
  if (resolved === undefined) return { title: "Lesson not found — X++Lab" };

  return {
    title: `${resolved.lesson.frontmatter.title} — X++Lab`,
    description: resolved.lesson.frontmatter.objectives.join(". "),
  };
}

export default async function LessonPage({ params }: PageProps<"/learn/[track]/[lesson]">) {
  const { track: trackSlug, lesson: lessonSlug } = await params;
  if (resolve(trackSlug, lessonSlug) === undefined) notFound();

  // Only strings cross the boundary — the MDX content is a function, and functions
  // cannot be passed from a server component to a client one.
  return <LessonScreen trackSlug={trackSlug} lessonSlug={lessonSlug} />;
}
