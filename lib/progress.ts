"use client";

/**
 * Lesson progress, in localStorage.
 *
 * Exposed as a subscribable store rather than read in an effect. Two reasons:
 *
 *   - Reading browser-only state in a mount effect means a synchronous setState in an
 *     effect: a second render before paint, and the progress footer visibly flickering
 *     from "0 of 3" to "2 of 3" on every visit.
 *   - The lesson page is prerendered, so a lazy `useState` initialiser reading
 *     localStorage would disagree with the server HTML and break hydration.
 *
 * `useSyncExternalStore` is built for exactly this: a server snapshot, a client
 * snapshot, and a subscription. Phase 11 swaps the backing store for an account without
 * touching either component.
 */

import { useSyncExternalStore } from "react";

const PREFIX = "xpplab:progress";

const listeners = new Set<() => void>();

/**
 * Cached because `useSyncExternalStore` demands a stable snapshot: returning a fresh
 * object each call would re-render forever. Invalidated on write, and on a `storage`
 * event so two open tabs agree.
 */
let cache: string | undefined;

function key(lessonSlug: string, taskId: string): string {
  return `${PREFIX}:${lessonSlug}:${taskId}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    cache = undefined;
    for (const notify of listeners) notify();
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Every solved key, joined. A string so the snapshot compares by value. */
function getSnapshot(): string {
  if (cache !== undefined) return cache;

  const solved: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const storageKey = window.localStorage.key(index);
    if (storageKey === null || !storageKey.startsWith(PREFIX)) continue;
    if (window.localStorage.getItem(storageKey) === "solved") solved.push(storageKey);
  }

  cache = solved.sort().join("|");
  return cache;
}

/** Nothing is solved on the server, which is what the prerendered HTML must say. */
function getServerSnapshot(): string {
  return "";
}

export function markSolved(lessonSlug: string, taskId: string): void {
  window.localStorage.setItem(key(lessonSlug, taskId), "solved");
  cache = undefined;
  for (const notify of listeners) notify();
}

/** The set of solved task ids for one lesson. */
export function useSolvedTasks(lessonSlug: string, taskIds: string[]): Set<string> {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const solvedKeys = new Set(snapshot.length === 0 ? [] : snapshot.split("|"));
  return new Set(taskIds.filter((taskId) => solvedKeys.has(key(lessonSlug, taskId))));
}

/** Whether one task is solved. */
export function useIsSolved(lessonSlug: string, taskId: string): boolean {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return snapshot.split("|").includes(key(lessonSlug, taskId));
}
