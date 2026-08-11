/**
 * The lesson registry for this track.
 *
 * Static imports rather than a filesystem glob: the bundler can see them, the types are
 * real, and a lesson that fails to compile breaks the build instead of 404ing at
 * runtime. It is a line per lesson, which is the right amount of friction for something
 * that should be a deliberate act.
 */

import type { LessonFrontmatter, TaskDefinition, TrackDefinition } from "@xpplab/validators";
import type { MdxContent } from "@/components/lesson/lesson-view";
import trackJson from "./track.json";
import BuffersAndSelect, {
  frontmatter as buffersAndSelectFrontmatter,
  tasks as buffersAndSelectTasks,
} from "./02-buffers-and-select.mdx";

export interface Lesson {
  frontmatter: LessonFrontmatter;
  tasks: TaskDefinition[];
  Content: MdxContent;
}

export const track = trackJson as TrackDefinition;

/**
 * MDX exports arrive untyped — a `.d.ts` cannot know which lesson it is describing — so
 * each is asserted at its single point of entry. `lesson.test.ts` runs every task's
 * solution through its own validators, which is what actually proves these shapes.
 */
export const lessons: Record<string, Lesson> = {
  "02-buffers-and-select": {
    frontmatter: buffersAndSelectFrontmatter as unknown as LessonFrontmatter,
    tasks: buffersAndSelectTasks as unknown as TaskDefinition[],
    Content: BuffersAndSelect,
  },
};

export function getLesson(slug: string): Lesson | undefined {
  return lessons[slug];
}

/** Lesson slugs in the order `track.json` lists them, skipping any that are missing. */
export function orderedSlugs(): string[] {
  return track.lessons.filter((slug) => slug in lessons);
}
