/**
 * Debugger support for the interpreter.
 *
 * This module owns the *decision* — should execution stop here, and where does it stop
 * next — and nothing else. Gathering the state that the debugger windows show needs the
 * scope chain and the table schema, so the interpreter does that part and hands it over.
 *
 * The whole thing is possible because the interpreter is asynchronous all the way down:
 * pausing is just declining to resolve a promise until the UI sends a command. Nothing
 * blocks, and the worker stays responsive while a learner reads the Locals window.
 *
 * Every command and shortcut modelled here traces to a row in docs/verified-behaviour.md.
 * The debugger is a teaching surface as much as the language is, and a learner who
 * memorises a key that does nothing in the real product has been taught something false.
 */

import type { InfologEntry } from "@xpplab/xpp-core";

/**
 * What the UI sends back to resume a paused run.
 *
 * These are the Debug menu's commands, under the names the menu uses. `stepOver` is F10
 * and `continue` is F5 (VB-022); `stop` is **Stop Debugging**.
 */
export type DebugCommand = "continue" | "stepOver" | "stepInto" | "stepOut" | "stop";

/** Why execution stopped, so the UI can say so. */
export type PauseReason = "breakpoint" | "step";

/**
 * A breakpoint, with the three refinements the real debugger offers (VB-025).
 *
 * `condition` is an X++ expression evaluated in the paused scope. `hitCount` reads the way
 * the source describes it — "break every two times the breakpoint is hit, or every 10
 * times" — so it breaks on every *n*th arrival rather than only the *n*th.
 */
export interface Breakpoint {
  line: number;
  /** A disabled breakpoint stays in the Breakpoints window but never stops anything. */
  enabled?: boolean;
  condition?: string;
  hitCount?: number;
}

/**
 * One field of a table buffer in the Locals window.
 *
 * `selected` is `false` for a field the `select` statement's field list left out. The real
 * debugger renders those as `null` (VB-024), which is a debugging artifact rather than the
 * value the field actually holds — it holds its type's default. Carrying the flag lets the
 * UI show the artifact *and* explain it, which is the entire point of teaching it.
 */
export interface DebugField {
  name: string;
  value: string;
  selected: boolean;
}

export interface DebugVariable {
  name: string;
  /** The declared type, as written. */
  typeName: string;
  value: string;
  /** Present only on table buffers, which expand to their fields in Locals. */
  fields?: DebugField[];
}

/** One frame of the call stack, innermost first. */
export interface DebugFrame {
  name: string;
  line: number;
}

/**
 * The Autos window's contents (VB-023).
 *
 * The real window shows four things: the current company, the partition, the transaction
 * level, and the current user ID. We simulate two of them. Partitions and users are not
 * modelled anywhere in this engine, so emitting a value for either would be inventing one
 * — the UI renders those rows greyed and labelled as not simulated, which teaches the
 * window's real contents without lying about ours. See CLAUDE.md > Fidelity rule.
 */
export interface DebugAutos {
  company: string;
  transactionLevel: number;
}

/** Everything the debugger windows render at a stop. */
export interface DebugPause {
  reason: PauseReason;
  line: number;
  statementsExecuted: number;
  locals: DebugVariable[];
  callStack: DebugFrame[];
  autos: DebugAutos;
  /** The Infolog so far — the real debugger shows it live, under View > Infolog. */
  infolog: InfologEntry[];
}

/**
 * The interpreter's view of where it currently is.
 *
 * `state` and `test` are callbacks rather than data because building the locals list and
 * evaluating a condition both cost real work, and a run with one breakpoint on line 40
 * executes thousands of statements that need neither.
 */
export interface StatementCursor {
  line: number;
  /** Call depth, 0 at the top-level script. Step over and step out are relative to it. */
  depth: number;
  state(reason: PauseReason): Promise<DebugPause>;
  /**
   * Evaluates a breakpoint condition in the paused scope. A condition that does not parse,
   * or that blows up, resolves `false` — a broken condition must not take the whole run
   * down with it.
   */
  test(expression: string): Promise<boolean>;
}

export interface DebugHost {
  /**
   * Read fresh at every arrival, so breakpoints added while paused take effect
   * immediately — which is what the real debugger does.
   */
  breakpoints(): readonly Breakpoint[];
  onPause(pause: DebugPause): Promise<DebugCommand>;
}

type StepMode = "into" | "over" | "out";

/**
 * Decides where a debugged run stops.
 *
 * Starts in "run" mode with no pending step: pressing F5 with no breakpoints set runs the
 * code to completion without stopping anywhere (VB-022). That is not a bug to paper over
 * — a learner who sets no breakpoints and sees the program simply finish has learned what
 * Start Debugging actually does.
 */
export class DebugController {
  readonly #host: DebugHost;
  readonly #hits = new Map<number, number>();

  #stepMode: StepMode | undefined;
  #stepDepth = 0;
  #stopped = false;

  constructor(host: DebugHost) {
    this.#host = host;
  }

  /** `true` once the learner has pressed Stop Debugging. */
  get stopped(): boolean {
    return this.#stopped;
  }

  /** How many times each breakpoint line has been armed. Drives the Breakpoints window. */
  hitCounts(): ReadonlyMap<number, number> {
    return this.#hits;
  }

  /**
   * Called by the interpreter before every statement.
   *
   * Resolves `"stop"` when the run should be abandoned, `"continue"` otherwise — which
   * includes the case where it paused, the learner looked around, and pressed something.
   */
  async beforeStatement(cursor: StatementCursor): Promise<"continue" | "stop"> {
    if (this.#stopped) return "stop";

    const reason = await this.#reasonToPause(cursor);
    if (reason === undefined) return "continue";

    return this.#pause(cursor, reason);
  }

  async #reasonToPause(cursor: StatementCursor): Promise<PauseReason | undefined> {
    // A pending step wins. If a breakpoint sits on the line we were stepping to anyway,
    // the distinction is invisible to the learner and the step is the truer explanation.
    if (this.#stepMode !== undefined && this.#satisfiesStep(cursor.depth)) return "step";

    const breakpoint = this.#host
      .breakpoints()
      .find((candidate) => candidate.line === cursor.line && candidate.enabled !== false);
    if (breakpoint === undefined) return undefined;

    return (await this.#armed(breakpoint, cursor)) ? "breakpoint" : undefined;
  }

  #satisfiesStep(depth: number): boolean {
    switch (this.#stepMode) {
      // The next statement anywhere, including the first line of a method being called.
      case "into":
        return true;
      // The next statement in this frame or a shallower one — a call is stepped past.
      case "over":
        return depth <= this.#stepDepth;
      // Only once this frame has returned. Stepping out of the outermost frame therefore
      // runs to completion, which is what the real debugger does too.
      case "out":
        return depth < this.#stepDepth;
      default:
        return false;
    }
  }

  /**
   * Whether a breakpoint on this line actually fires this time.
   *
   * Condition first, then hit count: the source is explicit that "the breakpoint is hit
   * only if the condition is satisfied", so an arrival that fails the condition is not a
   * hit and must not advance the count.
   */
  async #armed(breakpoint: Breakpoint, cursor: StatementCursor): Promise<boolean> {
    if (breakpoint.condition !== undefined && !(await cursor.test(breakpoint.condition))) {
      return false;
    }

    const hits = (this.#hits.get(breakpoint.line) ?? 0) + 1;
    this.#hits.set(breakpoint.line, hits);

    const every = breakpoint.hitCount;
    return every === undefined || every <= 1 ? true : hits % every === 0;
  }

  async #pause(cursor: StatementCursor, reason: PauseReason): Promise<"continue" | "stop"> {
    const command = await this.#host.onPause(await cursor.state(reason));

    switch (command) {
      case "stop":
        this.#stopped = true;
        return "stop";

      case "continue":
        this.#stepMode = undefined;
        return "continue";

      case "stepInto":
      case "stepOver":
      case "stepOut":
        this.#stepMode = command === "stepInto" ? "into" : command === "stepOver" ? "over" : "out";
        this.#stepDepth = cursor.depth;
        return "continue";
    }
  }
}
