/**
 * Runtime failures.
 *
 * The interpreter never throws a raw JS error across the package boundary. Everything a
 * learner can cause arrives as a `RuntimeError` carrying an `XppErrorCode`, a message
 * modelled on the real one, and a hint.
 *
 * `xppException` matters more than it looks: it is the `Exception::` enum value this
 * failure presents as, and it is what a `catch (Exception::Deadlock)` matches on.
 */

import type { SourceSpan, XppError, XppErrorCode } from "@xpplab/xpp-core";

/**
 * Values of the X++ `Exception` enum, as published in the language reference. Only the
 * ones this simulator can actually raise are listed; the rest would be a lie.
 */
export type XppExceptionName =
  | "Error"
  | "Warning"
  | "Info"
  | "Deadlock"
  | "DuplicateKeyException"
  | "DuplicateKeyExceptionNotRecovered"
  | "UpdateConflict"
  | "UpdateConflictNotRecovered"
  | "Numeric"
  | "Timeout"
  | "Break";

export class RuntimeError extends Error {
  constructor(
    readonly code: XppErrorCode,
    message: string,
    readonly hint?: string,
    /** The `Exception::` value this presents as to a `catch`. Defaults to `Error`. */
    readonly xppException: XppExceptionName = "Error",
    public span?: SourceSpan,
  ) {
    super(message);
    this.name = "RuntimeError";
  }

  toXppError(): XppError {
    const start = this.span?.start;
    return {
      code: this.code,
      message: this.message,
      line: start?.line ?? 0,
      column: start?.column ?? 0,
      ...(this.span === undefined
        ? {}
        : { endLine: this.span.end.line, endColumn: this.span.end.column }),
      ...(this.hint === undefined ? {} : { hint: this.hint }),
    };
  }
}

/**
 * A learner-thrown exception, from `throw`.
 *
 * Distinct from `RuntimeError` because it is not a defect in their code — it is their
 * code working. It carries the `Exception::` value so `catch` can match on it.
 */
export class ThrownException extends Error {
  constructor(
    readonly xppException: XppExceptionName,
    /** The Infolog text, when the throw came from `error("…")`. */
    message = "",
    public span?: SourceSpan,
  ) {
    super(message);
    this.name = "ThrownException";
  }
}

/** Raised when the execution budget runs out. Not catchable — the run is over. */
export class BudgetExceeded extends Error {
  constructor(
    readonly code: XppErrorCode,
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

/**
 * Whether a `catch` qualified with `exceptionName` catches `thrown`.
 *
 * An unqualified `catch` catches everything *except* `UpdateConflict` and
 * `DuplicateKeyException` inside a transaction — but that carve-out is enforced by the
 * interpreter, which knows the transaction depth, not here.
 */
export function catchMatches(exceptionName: string | undefined, thrown: XppExceptionName): boolean {
  if (exceptionName === undefined) return true;
  return exceptionName.toLowerCase() === thrown.toLowerCase();
}

/** VB-008: these two are the only exceptions catchable inside their own transaction. */
export function isCatchableInsideTransaction(thrown: XppExceptionName): boolean {
  return thrown === "UpdateConflict" || thrown === "DuplicateKeyException";
}
