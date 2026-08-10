/**
 * Shareable permalinks.
 *
 * The code and the environment go in the URL fragment, not the query string, so they are
 * never sent to the server. That is not incidental: the whole product runs client-side,
 * and a permalink that quietly POSTed a learner's code somewhere would undermine the
 * claim.
 *
 * base64url of UTF-8 JSON. No compression library — a lesson-sized snippet is a few
 * hundred characters, and a dependency to save a few more is not worth carrying.
 */

export interface PermalinkState {
  source: string;
  company: string;
  seed?: string;
}

/** Long enough to be a warning sign, short enough that real snippets never hit it. */
const MAX_ENCODED_LENGTH = 32_000;

export function encodePermalink(state: PermalinkState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePermalink(encoded: string): PermalinkState | undefined {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH) return undefined;

  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    // A permalink is untrusted input — someone else wrote it. Validate the shape rather
    // than trusting it into the editor and the engine.
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate["source"] !== "string" || typeof candidate["company"] !== "string") {
      return undefined;
    }

    return {
      source: candidate["source"],
      company: candidate["company"],
      ...(typeof candidate["seed"] === "string" ? { seed: candidate["seed"] } : {}),
    };
  } catch {
    // A malformed fragment should load the default playground, not an error page.
    return undefined;
  }
}

export function readPermalinkFromLocation(hash: string): PermalinkState | undefined {
  const match = /^#code=(.+)$/.exec(hash);
  return match?.[1] === undefined ? undefined : decodePermalink(match[1]);
}

export function permalinkUrl(origin: string, pathname: string, state: PermalinkState): string {
  return `${origin}${pathname}#code=${encodePermalink(state)}`;
}
