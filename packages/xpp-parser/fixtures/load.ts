/**
 * Splits the corpus files into named snippets.
 *
 * The corpus lives in two `.xpp` files rather than 60 tiny ones so it stays readable as
 * a whole and syntax-highlights in the editor. `//== name` starts a snippet.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Snippet {
  name: string;
  source: string;
  /** 1-based line of this snippet's first line within the corpus file. */
  startLine: number;
}

const MARKER = /^\/\/== (.+)$/;

export function splitCorpus(text: string): Snippet[] {
  const snippets: Snippet[] = [];
  const lines = text.split(/\r?\n/);

  let current: { name: string; startLine: number; body: string[] } | undefined;

  lines.forEach((line, index) => {
    const match = MARKER.exec(line);
    if (match) {
      if (current) snippets.push(finish(current));
      current = { name: match[1]!.trim(), startLine: index + 2, body: [] };
      return;
    }
    current?.body.push(line);
  });

  if (current) snippets.push(finish(current));
  return snippets;
}

function finish(current: { name: string; startLine: number; body: string[] }): Snippet {
  // Trim trailing blank lines so a snippet's length does not depend on the spacing
  // before the next marker.
  const body = [...current.body];
  while (body.length > 0 && body.at(-1)!.trim() === "") body.pop();
  return { name: current.name, source: body.join("\n"), startLine: current.startLine };
}

function read(file: string): Snippet[] {
  return splitCorpus(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
}

export const validSnippets = (): Snippet[] => read("./valid.xpp");
export const errorSnippets = (): Snippet[] => read("./errors.xpp");
