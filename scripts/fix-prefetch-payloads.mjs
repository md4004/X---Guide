/**
 * Works around a Next 16 static-export mismatch in the App Router's prefetch payloads.
 *
 * `next build` with `output: "export"` writes each route's prefetch payload as a nested
 * directory:
 *
 *   learn/xpp-fundamentals/01-hello-infolog/__next.learn/$d$track/$d$lesson/__PAGE__.txt
 *
 * but the client asks for the same thing with the segments joined by dots:
 *
 *   learn/xpp-fundamentals/01-hello-infolog/__next.learn.$d$track.$d$lesson.__PAGE__.txt
 *
 * Nothing breaks — a 404 on a prefetch just means the router falls back to a full
 * navigation — but it costs a failed request per link and fills the console with 404s on
 * a site whose whole pitch is that it is fast and self-contained.
 *
 * This copies each payload to the name the client actually requests. A copy rather than a
 * move, so the emitted layout is left intact and this becomes a harmless no-op if a
 * future Next release starts emitting both shapes, or the flat one.
 *
 * Delete this script once `pnpm build` emits payloads the client can find.
 */

import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "out");

if (!fs.existsSync(OUT)) {
  console.error(`No export at ${OUT}. Run the static build first.`);
  process.exit(1);
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? filesUnder(full).map((child) => path.join(entry.name, child))
      : [entry.name];
  });
}

let copied = 0;
let skipped = 0;

/** Walks the export looking for `__next.*` payload directories. */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);

    if (entry.name.startsWith("__next.")) {
      for (const relative of filesUnder(full)) {
        // `__next.learn` + `$d$track/$d$lesson/__PAGE__.txt` -> one dot-joined filename.
        const flat = [entry.name, ...relative.split(path.sep)].join(".");
        const target = path.join(dir, flat);

        if (fs.existsSync(target)) {
          skipped++;
          continue;
        }
        fs.copyFileSync(path.join(full, relative), target);
        copied++;
      }
      // Payload directories contain only payloads, so there is nothing deeper to visit.
      continue;
    }

    walk(full);
  }
}

walk(OUT);

console.log(
  `prefetch payloads: ${copied} copied to their requested names` +
    (skipped > 0 ? `, ${skipped} already present` : ""),
);
