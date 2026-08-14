import createMDX from "@next/mdx";
import type { NextConfig } from "next";

/**
 * Static hosting, opt-in.
 *
 * Nothing in this app runs on a server: no API routes, no middleware, no server actions,
 * and every page is prerendered. So it exports to plain files and can sit on any static
 * host — which is what `NEXT_STATIC_EXPORT=1` turns on.
 *
 * `NEXT_PUBLIC_BASE_PATH` exists because GitHub Pages serves a project site from a
 * subdirectory rather than a domain root. It is deliberately opt-in: leaving both unset
 * keeps `pnpm dev`, `pnpm build` and the Playwright suite behaving exactly as they do
 * locally, so the deploy configuration cannot quietly change what CI tests.
 *
 * The `NEXT_PUBLIC_` prefix matters — the value is inlined at build time and is read
 * inside the engine worker, which is a separate bundle with no access to server env.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const staticExport = process.env.NEXT_STATIC_EXPORT === "1";

/**
 * Engine packages ship raw TypeScript from `src/` — there is no build step for them.
 * Next transpiles them here; Vitest resolves them directly. One less pipeline to maintain.
 */
const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  ...(staticExport ? { output: "export" as const } : {}),
  ...(basePath === "" ? {} : { basePath, assetPrefix: basePath }),
  // Directory-style URLs, so `/learn/x/` resolves to its own index.html on a host that
  // does no rewriting of its own.
  ...(staticExport ? { trailingSlash: true } : {}),
  transpilePackages: [
    "@xpplab/xpp-core",
    "@xpplab/xpp-lexer",
    "@xpplab/xpp-parser",
    "@xpplab/xpp-runtime",
    "@xpplab/virtual-db",
    "@xpplab/virtual-aot",
    "@xpplab/renderers",
    "@xpplab/validators",
    "@xpplab/scenarios",
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
