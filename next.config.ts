import type { NextConfig } from "next";

/**
 * Engine packages ship raw TypeScript from `src/` — there is no build step for them.
 * Next transpiles them here; Vitest resolves them directly. One less pipeline to maintain.
 */
const nextConfig: NextConfig = {
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

export default nextConfig;
