/**
 * The real lesson registry, for tests.
 *
 * Imports the same module the site serves, so a lesson cannot pass here and be broken
 * in the browser. The registry itself imports the `.mdx` files, which Vitest compiles
 * through the same remark plugins Next uses.
 */

import type { TaskDefinition } from "../src/index";
// The data half of the registry, which carries no React dependency — see the note at
// the top of that file.
import {
  lessonData,
  track,
  type LessonData,
} from "../../../content/tracks/xpp-for-nav-devs/lessons";

export type TestLesson = LessonData;

/** `[slug, lesson]` pairs in the order track.json lists them. */
export function lessonList(): [string, TestLesson][] {
  return track.lessons
    .filter((slug) => slug in lessonData)
    .map((slug) => [slug, lessonData[slug]!]);
}

/**
 * `[label, task]` pairs across the whole track, for `it.each`.
 *
 * The label is a string rather than the task object, because `it.each` with `%s` prints
 * whatever it is given — and a whole task definition in a test name is unreadable.
 */
export function allTasks(): [string, TaskDefinition][] {
  return lessonList().flatMap(([slug, lesson]) =>
    lesson.tasks.map((task): [string, TaskDefinition] => [`${slug} / ${task.id}`, task]),
  );
}
