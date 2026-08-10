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
import { PANEL_TABLES, type EngineReply, type EngineRequest } from "./run-protocol";

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

  // Deliberately no `ready` flag. Setting one from inside the mount effect would be a
  // synchronous setState in an effect — a second render before paint, for a value the
  // caller can infer from its first reply.
  const [state, setState] = useState<EngineState>({ busy: false });

  useEffect(() => {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    const pending = pendingRef.current;

    worker.onmessage = (event: MessageEvent<EngineReply>) => {
      const resolve = pending.get(event.data.id);
      if (resolve === undefined) return;
      pending.delete(event.data.id);
      resolve(event.data);
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

  return { ...state, run, reset, read };
}
