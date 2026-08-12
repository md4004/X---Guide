"use client";

/**
 * The client half of the engine worker.
 *
 * Owns the Worker for the lifetime of the playground and turns its message protocol into
 * promises. The `new Worker(new URL(...))` call is written out literally because that is
 * the form the bundler statically detects — passing a path through a variable produces a
 * worker that works in dev and 404s in production.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StepView, TaskDefinition } from "@xpplab/validators";
import type { Breakpoint, DebugCommand, DebugPause } from "@xpplab/xpp-runtime";
import {
  PANEL_TABLES,
  type DebugCommandMessage,
  type EngineOutbound,
  type EngineReply,
  type EngineRequest,
  type TaskOutcome,
} from "./run-protocol";

export type RunOutcome = NonNullable<EngineReply["result"]>;

/**
 * `Omit` over a union collapses to the keys they share, which would erase `source` and
 * `company`. Distributing keeps each member's own shape.
 */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

export interface EngineState {
  busy: boolean;
  /** A worker-level failure, as distinct from an error in the learner's X++. */
  failure?: string;
}

export function useEngine() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (reply: EngineReply) => void>());
  const nextIdRef = useRef(0);
  /**
   * Where a `paused` event goes.
   *
   * Separate from `pendingRef` because a debugged run pauses many times before it replies
   * once, so resolving-and-deleting by id — which is what every other request does — would
   * discard the run on the first breakpoint.
   */
  const onPausedRef = useRef<((pause: DebugPause) => void) | undefined>(undefined);

  // Deliberately no `ready` flag. Setting one from inside the mount effect would be a
  // synchronous setState in an effect — a second render before paint, for a value the
  // caller can infer from its first reply.
  const [state, setState] = useState<EngineState>({ busy: false });

  useEffect(() => {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    const pending = pendingRef.current;

    worker.onmessage = (event: MessageEvent<EngineOutbound>) => {
      const message = event.data;

      if ("kind" in message && message.kind === "paused") {
        onPausedRef.current?.(message.pause);
        return;
      }

      const resolve = pending.get(message.id);
      if (resolve === undefined) return;
      pending.delete(message.id);
      resolve(message as EngineReply);
    };

    worker.onerror = (event) => {
      setState((current) => ({ ...current, busy: false, failure: event.message }));
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      // The captured map, not pendingRef.current, which may have been replaced by now.
      pending.clear();
    };
  }, []);

  const send = useCallback(
    async (request: WithoutId<EngineRequest>): Promise<RunOutcome | undefined> => {
      const worker = workerRef.current;
      if (worker === null) return undefined;

      setState((current) => ({ ...current, busy: true, failure: undefined }));

      const id = nextIdRef.current++;
      const reply = await new Promise<EngineReply>((resolve) => {
        pendingRef.current.set(id, resolve);
        worker.postMessage({ ...request, id } as EngineRequest);
      });

      setState((current) => ({
        ...current,
        busy: false,
        ...(reply.ok ? {} : { failure: reply.error ?? "The engine failed." }),
      }));

      return reply.result;
    },
    [],
  );

  const run = useCallback(
    (source: string, company: string) =>
      send({ kind: "run", source, company, tables: PANEL_TABLES }),
    [send],
  );

  const reset = useCallback(() => send({ kind: "reset", tables: PANEL_TABLES }), [send]);

  const read = useCallback(
    (company: string) => send({ kind: "read", company, tables: PANEL_TABLES }),
    [send],
  );

  /**
   * Checks a lesson task. Returns the outcome rather than a run result, because a task
   * has a different question to answer: not "what happened" but "is this right, and if
   * not, which one thing should they be told".
   */
  const runTask = useCallback(
    async (
      task: TaskDefinition,
      source: string,
      view?: StepView,
    ): Promise<TaskOutcome | undefined> => {
      const worker = workerRef.current;
      if (worker === null) return undefined;

      setState((current) => ({ ...current, busy: true, failure: undefined }));

      const id = nextIdRef.current++;
      const reply = await new Promise<EngineReply>((resolve) => {
        pendingRef.current.set(id, resolve);
        worker.postMessage({
          kind: "task",
          task,
          source,
          id,
          ...(view === undefined ? {} : { view }),
        } satisfies EngineRequest);
      });

      setState((current) => ({
        ...current,
        busy: false,
        ...(reply.ok ? {} : { failure: reply.error ?? "The engine failed." }),
      }));

      return reply.task;
    },
    [],
  );

  /**
   * Runs a reading step's example. Same panels as a task, no verdict.
   *
   * Kept beside `runTask` rather than folded into `run`, because the playground's `run`
   * deliberately does not restore — it is a sandbox, and a lesson example is not.
   */
  const preview = useCallback(
    async (source: string, view?: StepView): Promise<TaskOutcome | undefined> => {
      const worker = workerRef.current;
      if (worker === null) return undefined;

      setState((current) => ({ ...current, busy: true, failure: undefined }));

      const id = nextIdRef.current++;
      const reply = await new Promise<EngineReply>((resolve) => {
        pendingRef.current.set(id, resolve);
        worker.postMessage({
          kind: "preview",
          source,
          id,
          ...(view === undefined ? {} : { view }),
        } satisfies EngineRequest);
      });

      setState((current) => ({
        ...current,
        busy: false,
        ...(reply.ok ? {} : { failure: reply.error ?? "The engine failed." }),
      }));

      return reply.task;
    },
    [],
  );

  /**
   * Starts a debugged run — F5.
   *
   * `onPause` is called every time execution stops and must eventually be answered with
   * `resume`. The returned promise settles only when the run finishes or is stopped, so a
   * caller can await the final state without also having to track the pauses.
   */
  const debug = useCallback(
    async (
      source: string,
      company: string,
      breakpoints: Breakpoint[],
      onPause: (pause: DebugPause) => void,
      entryPoint?: string,
    ): Promise<RunOutcome | undefined> => {
      const worker = workerRef.current;
      if (worker === null) return undefined;

      setState((current) => ({ ...current, busy: true, failure: undefined }));
      onPausedRef.current = onPause;

      const id = nextIdRef.current++;
      const reply = await new Promise<EngineReply>((resolve) => {
        pendingRef.current.set(id, resolve);
        worker.postMessage({
          kind: "debug",
          id,
          source,
          company,
          breakpoints,
          tables: PANEL_TABLES,
          ...(entryPoint === undefined ? {} : { entryPoint }),
        } satisfies EngineRequest);
      });

      onPausedRef.current = undefined;
      setState((current) => ({
        ...current,
        busy: false,
        ...(reply.ok ? {} : { failure: reply.error ?? "The engine failed." }),
      }));

      return reply.result;
    },
    [],
  );

  /** Answers a pause. Carries the current breakpoints so edits made while paused count. */
  const resume = useCallback((command: DebugCommand, breakpoints: Breakpoint[]) => {
    workerRef.current?.postMessage({
      kind: "debugCommand",
      command,
      breakpoints,
    } satisfies DebugCommandMessage);
  }, []);

  return { ...state, run, reset, read, runTask, preview, debug, resume };
}
