import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Engine packages ship raw TypeScript, so Vitest resolves them straight to source.
 * No build step, no stale dist, and a stack trace points at the file you edited.
 */
export default defineConfig({
  resolve: {
    alias: {
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
    include: ["packages/*/test/**/*.test.ts"],
    // Playwright owns everything under e2e/.
    exclude: ["**/node_modules/**", "e2e/**", ".next/**"],
  },
});
