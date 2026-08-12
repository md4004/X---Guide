/**
 * The lesson data: frontmatter, steps and tasks, with no React in sight.
 *
 * Split from `index.ts` deliberately. The validators package tests import this file to
 * run every task's solution through its own validators, and an engine package has no
 * business reaching into app-level component types to do that.
 */

import type {
  LessonFrontmatter,
  LessonStep,
  TaskDefinition,
  TrackDefinition,
} from "@xpplab/validators";
import trackJson from "./track.json";

import { frontmatter as f01, steps as s01, tasks as t01 } from "./01-hello-infolog.mdx";
import { frontmatter as f02, steps as s02, tasks as t02 } from "./02-buffers-and-select.mdx";
import { frontmatter as f03, steps as s03, tasks as t03 } from "./03-transactions.mdx";
import { frontmatter as f04, steps as s04, tasks as t04 } from "./04-insert-update-delete.mdx";
import { frontmatter as f05, steps as s05, tasks as t05 } from "./05-joins.mdx";
import { frontmatter as f06, steps as s06, tasks as t06 } from "./06-set-based.mdx";
import { frontmatter as f07, steps as s07, tasks as t07 } from "./07-companies.mdx";
import { frontmatter as f08, steps as s08, tasks as t08 } from "./08-exceptions.mdx";
import { frontmatter as f09, steps as s09, tasks as t09 } from "./09-forms.mdx";
import { frontmatter as f10, steps as s10, tasks as t10 } from "./10-reports.mdx";
import { frontmatter as f11, steps as s11, tasks as t11 } from "./11-financial-dimensions.mdx";
import { frontmatter as f12, steps as s12, tasks as t12 } from "./12-integration.mdx";

export interface LessonData {
  frontmatter: LessonFrontmatter;
  steps: LessonStep[];
  tasks: TaskDefinition[];
}

export const track = trackJson as TrackDefinition;

/**
 * MDX exports arrive untyped — a `.d.ts` cannot know which lesson it is describing — so
 * each is asserted here, at its single point of entry. The lesson tests are what actually
 * prove these shapes.
 */
const data = (frontmatter: unknown, steps: unknown, tasks: unknown): LessonData => ({
  frontmatter: frontmatter as LessonFrontmatter,
  steps: steps as LessonStep[],
  tasks: tasks as TaskDefinition[],
});

export const lessonData: Record<string, LessonData> = {
  "01-hello-infolog": data(f01, s01, t01),
  "02-buffers-and-select": data(f02, s02, t02),
  "03-transactions": data(f03, s03, t03),
  "04-insert-update-delete": data(f04, s04, t04),
  "05-joins": data(f05, s05, t05),
  "06-set-based": data(f06, s06, t06),
  "07-companies": data(f07, s07, t07),
  "08-exceptions": data(f08, s08, t08),
  "09-forms": data(f09, s09, t09),
  "10-reports": data(f10, s10, t10),
  "11-financial-dimensions": data(f11, s11, t11),
  "12-integration": data(f12, s12, t12),
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
