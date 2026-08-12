/**
 * Parse and run in one call.
 *
 * A parse failure returns the parse errors and runs nothing — step 2 of the runner
 * contract in docs/lesson-schema.md. Executing a half-understood tree would produce
 * confusing state changes on top of an already-confusing error.
 */

import { parse } from "@xpplab/xpp-parser";
import type { VirtualDb } from "@xpplab/virtual-db";
import type { CompanyId } from "@xpplab/xpp-core";
import type { DebugHost } from "./debug";
import { run, type RunResult } from "./interpreter";

export interface RunSourceOptions {
  source: string;
  db: VirtualDb;
  company?: CompanyId;
  timeoutMs?: number;
  maxStatements?: number;
  today?: string;
  /** Attaches the debugger. See `RunOptions.debug`. */
  debug?: DebugHost;
  /** Names the outermost call-stack frame. See `RunOptions.entryPoint`. */
  entryPoint?: string;
}

export interface RunSourceResult extends RunResult {
  /** `true` when the code never made it past the parser. */
  parseFailed: boolean;
}

export async function runSource(options: RunSourceOptions): Promise<RunSourceResult> {
  const { ast, errors } = parse(options.source);

  if (errors.length > 0 || ast === null) {
    return {
      ok: false,
      parseFailed: true,
      infolog: [],
      sqlTrace: [],
      errors,
      statementsExecuted: 0,
      durationMs: 0,
      uncommittedTransactionDepth: 0,
    };
  }

  const result = await run({
    ast,
    db: options.db,
    ...(options.company === undefined ? {} : { company: options.company }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxStatements === undefined ? {} : { maxStatements: options.maxStatements }),
    ...(options.today === undefined ? {} : { today: options.today }),
    ...(options.debug === undefined ? {} : { debug: options.debug }),
    ...(options.entryPoint === undefined ? {} : { entryPoint: options.entryPoint }),
  });

  return { ...result, parseFailed: false };
}
