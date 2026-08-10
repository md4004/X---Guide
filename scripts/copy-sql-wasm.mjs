/**
 * Copies sql.js's WASM binary into /public so the browser can fetch it.
 *
 * A build step rather than a committed binary: the file has to match the installed
 * sql.js version exactly, and a copy checked into git would silently drift the next time
 * the dependency moves. Runs before dev and build.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// sql.js belongs to @xpplab/virtual-db, not to the root package, and pnpm links strictly.
// Resolving from the package that actually depends on it is the difference between this
// working and a MODULE_NOT_FOUND.
// sql.js's `exports` map does not expose ./package.json, but does expose the dist files,
// so resolve the binary directly.
const require = createRequire(join(root, "packages", "virtual-db", "package.json"));
const source = require.resolve("sql.js/dist/sql-wasm.wasm");

const target = join(root, "public", "sql-wasm.wasm");

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(source, target);

console.log(`Copied ${source} -> ${target}`);
