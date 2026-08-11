import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Engine packages ship raw TypeScript, so Vitest resolves them straight to source.
 * No build step, no stale dist, and a stack trace points at the file you edited.
 *
 * MDX is compiled here as well as by Next, because the lesson tests import the real
 * `.mdx` files. Testing a copy of the task definitions would leave the actual lesson
 * unverified, which is the one thing Phase 5's acceptance criterion is about.
 */
export default defineConfig({
  plugins: [
    mdx({
      // Must match next.config.ts, or a lesson can pass here and render differently in
      // the browser. remark-gfm is what turns pipe tables into tables.
      remarkPlugins: [
        remarkFrontmatter,
        [remarkMdxFrontmatter, { name: "frontmatter" }],
        remarkGfm,
      ],
    }),
  ],
  resolve: {
    alias: {
      // The lesson registry lives in content/ and is reached by tests, so the app's
      // `@/` alias has to resolve here too.
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@xpplab/xpp-core": pkg("xpp-core"),
      "@xpplab/xpp-lexer": pkg("xpp-lexer"),
      "@xpplab/xpp-parser": pkg("xpp-parser"),
      "@xpplab/xpp-runtime": pkg("xpp-runtime"),
      "@xpplab/virtual-db": pkg("virtual-db"),
      "@xpplab/virtual-aot": pkg("virtual-aot"),
      "@xpplab/renderers": pkg("renderers"),
      "@xpplab/validators": pkg("validators"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "lib/**/*.test.ts"],
    // Playwright owns everything under e2e/.
    exclude: ["**/node_modules/**", "e2e/**", ".next/**"],
  },
});
