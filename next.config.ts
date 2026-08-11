import createMDX from "@next/mdx";
import type { NextConfig } from "next";

/**
 * Engine packages ship raw TypeScript from `src/` — there is no build step for them.
 * Next transpiles them here; Vitest resolves them directly. One less pipeline to maintain.
 */
const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  transpilePackages: [
    "@xpplab/xpp-core",
    "@xpplab/xpp-lexer",
    "@xpplab/xpp-parser",
    "@xpplab/xpp-runtime",
    "@xpplab/virtual-db",
    "@xpplab/virtual-aot",
    "@xpplab/renderers",
    "@xpplab/validators",
  ],
  typedRoutes: true,
};

/**
 * Lessons are MDX with YAML frontmatter and `steps`/`tasks` exports at the bottom, per
 * docs/lesson-schema.md. `remark-mdx-frontmatter` turns the YAML block into a
 * `frontmatter` export so the lesson page can read the title and objectives without a
 * separate manifest to keep in sync.
 *
 * `remark-gfm` is what makes pipe tables tables. Without it they render as a run-on
 * paragraph of pipes, which is how they shipped until someone looked at the page.
 *
 * The same plugins are configured in vitest.config.mts, because the lesson tests import
 * the real `.mdx` files rather than a copy of their task definitions.
 */
const withMDX = createMDX({
  options: {
    // Named as strings, not imported functions. Turbopack serialises loader options and
    // rejects anything that is not a plain value, so passing the plugin itself fails the
    // build with "does not have serializable options".
    remarkPlugins: [
      ["remark-frontmatter"],
      ["remark-mdx-frontmatter", { name: "frontmatter" }],
      ["remark-gfm"],
    ],
  },
});

export default withMDX(nextConfig);
