/**
 * Types for `.mdx` imports.
 *
 * `@types/mdx` covers the default export. The three named exports are ours: `frontmatter`
 * comes from remark-mdx-frontmatter, and `steps` and `tasks` are the exports lesson
 * authors write at the bottom of the file per docs/lesson-schema.md.
 *
 * All three are typed loosely here and narrowed at the point of use, because a single
 * .d.ts cannot know which lesson it is describing.
 */
declare module "*.mdx" {
  import type { MDXProps } from "mdx/types";

  export const frontmatter: Record<string, unknown>;
  export const steps: unknown[];
  export const tasks: unknown[];

  export default function MDXContent(props: MDXProps): JSX.Element;
}
