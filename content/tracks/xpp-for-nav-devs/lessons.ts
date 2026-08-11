/**
 * The lesson data: frontmatter and tasks, with no React in sight.
 *
 * Split from `index.ts` deliberately. The validators package tests import this file to
 * run every task's solution through its own validators, and an engine package has no
 * business reaching into app-level component types to do that. This file depends only on
 * `@xpplab/validators`, which it already depends on anyway.
 *
 * `index.ts` re-exports all of this and adds the rendered MDX component for the app.
 */

import type { LessonFrontmatter, TaskDefinition, TrackDefinition } from "@xpplab/validators";
import trackJson from "./track.json";

import { frontmatter as f01, tasks as t01 } from "./01-hello-infolog.mdx";
import { frontmatter as f02, tasks as t02 } from "./02-buffers-and-select.mdx";
import { frontmatter as f03, tasks as t03 } from "./03-transactions.mdx";
import { frontmatter as f04, tasks as t04 } from "./04-insert-update-delete.mdx";
import { frontmatter as f05, tasks as t05 } from "./05-joins.mdx";
import { frontmatter as f06, tasks as t06 } from "./06-set-based.mdx";
import { frontmatter as f07, tasks as t07 } from "./07-companies.mdx";
import { frontmatter as f08, tasks as t08 } from "./08-exceptions.mdx";

export interface LessonData {
  frontmatter: LessonFrontmatter;
  tasks: TaskDefinition[];
}

export const track = trackJson as TrackDefinition;

/**
 * MDX exports arrive untyped — a `.d.ts` cannot know which lesson it is describing — so
 * each is asserted here, at its single point of entry. The lesson tests are what
 * actually prove these shapes.
 */
const data = (frontmatter: unknown, tasks: unknown): LessonData => ({
  frontmatter: frontmatter as LessonFrontmatter,
  tasks: tasks as TaskDefinition[],
});

export const lessonData: Record<string, LessonData> = {
  "01-hello-infolog": data(f01, t01),
  "02-buffers-and-select": data(f02, t02),
  "03-transactions": data(f03, t03),
  "04-insert-update-delete": data(f04, t04),
  "05-joins": data(f05, t05),
  "06-set-based": data(f06, t06),
  "07-companies": data(f07, t07),
  "08-exceptions": data(f08, t08),
};

/** Lesson slugs in the order `track.json` lists them, skipping any not yet written. */
export function orderedSlugs(): string[] {
  return track.lessons.filter((slug) => slug in lessonData);
}

/** The lesson before and after a given one, for the footer navigation. */
export function neighbours(slug: string): { previous?: string; next?: string } {
  const order = orderedSlugs();
  const index = order.indexOf(slug);
  if (index === -1) return {};
  return {
    ...(index > 0 ? { previous: order[index - 1]! } : {}),
    ...(index < order.length - 1 ? { next: order[index + 1]! } : {}),
  };
}
