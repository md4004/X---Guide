/**
 * The lesson registry the app renders.
 *
 * The data half — frontmatter, steps and tasks — lives in `lessons.ts`, which has no
 * React dependency so the engine's tests can import it. This file adds the compiled MDX
 * component for each lesson.
 */

import type { MdxContent } from "@/components/lesson/lesson-workspace";
import { lessonData, type LessonData } from "./lessons";

import HelloInfolog from "./01-hello-infolog.mdx";
import BuffersAndSelect from "./02-buffers-and-select.mdx";
import Transactions from "./03-transactions.mdx";
import InsertUpdateDelete from "./04-insert-update-delete.mdx";
import Joins from "./05-joins.mdx";
import SetBased from "./06-set-based.mdx";
import Companies from "./07-companies.mdx";
import Exceptions from "./08-exceptions.mdx";
import Forms from "./09-forms.mdx";
import Reports from "./10-reports.mdx";
import FinancialDimensions from "./11-financial-dimensions.mdx";
import Integration from "./12-integration.mdx";
import ClassesAndMethods from "./13-classes-and-methods.mdx";
import ReportEndToEnd from "./14-report-end-to-end.mdx";
import QueryObjects from "./15-query-objects.mdx";

export { track, orderedSlugs, neighbours } from "./lessons";
export type { LessonData } from "./lessons";

export interface Lesson extends LessonData {
  Content: MdxContent;
}

const CONTENT: Record<string, MdxContent> = {
  "01-hello-infolog": HelloInfolog,
  "02-buffers-and-select": BuffersAndSelect,
  "03-transactions": Transactions,
  "04-insert-update-delete": InsertUpdateDelete,
  "05-joins": Joins,
  "06-set-based": SetBased,
  "07-companies": Companies,
  "08-exceptions": Exceptions,
  "09-forms": Forms,
  "10-reports": Reports,
  "11-financial-dimensions": FinancialDimensions,
  "12-integration": Integration,
  "13-classes-and-methods": ClassesAndMethods,
  "14-report-end-to-end": ReportEndToEnd,
  "15-query-objects": QueryObjects,
};

export const lessons: Record<string, Lesson> = Object.fromEntries(
  Object.entries(lessonData).map(([slug, lesson]) => [
    slug,
    { ...lesson, Content: CONTENT[slug]! },
  ]),
);

export function getLesson(slug: string): Lesson | undefined {
  return lessons[slug];
}
