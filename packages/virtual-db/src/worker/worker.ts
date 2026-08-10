/**
 * The Web Worker entry point.
 *
 * Deliberately thin. All the behaviour is in `createRequestHandler`, which is tested
 * directly in Node — this file is only the postMessage wiring, and there is nothing here
 * worth a test that a browser would not also have to run.
 *
 * Bundled by Phase 4 with `new Worker(new URL("...worker.js", import.meta.url))`.
 */

import type { DbCoreOptions } from "../core/database.js";
import { createRequestHandler, type DbRequest, type RequestHandler } from "./protocol.js";

export type WorkerMessage =
  | { id: number; kind: "init"; options: DbCoreOptions }
  | { id: number; kind: "request"; request: DbRequest };

export type WorkerReply =
  | { id: number; ok: true; value: unknown; trace: unknown[] }
  | { id: number; ok: false; error: string };

declare const self: {
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  postMessage: (message: WorkerReply) => void;
};

let handler: RequestHandler | undefined;

self.onmessage = (event) => {
  const message = event.data;

  void (async () => {
    try {
      if (message.kind === "init") {
        handler = await createRequestHandler(message.options);
        self.postMessage({ id: message.id, ok: true, value: null, trace: [] });
        return;
      }

      if (handler === undefined) {
        throw new Error("The virtual database received a request before it was initialised.");
      }

      const result = await handler.handle(message.request);
      self.postMessage(
        result.ok
          ? { id: message.id, ok: true, value: result.value, trace: result.trace }
          : { id: message.id, ok: false, error: result.error },
      );
    } catch (error) {
      self.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
