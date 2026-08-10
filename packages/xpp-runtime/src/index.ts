/**
 * @xpplab/xpp-runtime — tree-walking interpreter for the X++ v1 subset.
 *
 * Not a compiler. It walks the AST, keeps a scope chain, dispatches methods, writes to
 * the Infolog and drives the virtual database's transaction manager.
 *
 * Two rules govern everything in here:
 *   1. It never throws a raw JS error across the package boundary. Failures come back
 *      as `XppError`.
 *   2. Runtime errors mirror real ones. `.update()` on a buffer that was not selected
 *      for update must fail the way a real AOS fails — this is a lesson, not an edge
 *      case. The behaviours enforced here are logged as VB-001 to VB-011 in
 *      docs/verified-behaviour.md.
 *
 * Layout:
 *   values.ts       XppValue, table buffers, coercions
 *   scope.ts        the scope chain, case-insensitive like X++ identifiers
 *   infolog.ts      the Infolog sink, including the rewind that `retry` needs
 *   builtins.ts     global functions
 *   errors.ts       RuntimeError, ThrownException, Exception:: matching
 *   interpreter.ts  the evaluator
 */

export { run, Interpreter } from "./interpreter";
export type { RunOptions, RunResult } from "./interpreter";

export { createInfolog } from "./infolog";
export type { Infolog } from "./infolog";

export { Scope, closestName } from "./scope";

export {
  RuntimeError,
  ThrownException,
  BudgetExceeded,
  catchMatches,
  isCatchableInsideTransaction,
} from "./errors";
export type { XppExceptionName } from "./errors";

export { BUILTINS, callBuiltin, isBuiltin, formatString } from "./builtins";
export type { Builtin, BuiltinContext } from "./builtins";

export {
  VOID,
  NULL,
  int,
  real,
  str,
  bool,
  date,
  defaultValueFor,
  toBoolean,
  toNumber,
  toDisplayString,
  toSqlValue,
  fromSqlValue,
  valuesEqual,
  arithmeticResult,
} from "./values";
export type { XppValue, TableBuffer, ObjectInstance, XppCollection } from "./values";

/**
 * Parse and run in one call.
 *
 * The lesson runner wants this: it has source, not an AST, and a parse failure means no
 * validators run at all (see the runner contract in docs/lesson-schema.md).
 */
export { runSource } from "./runSource";
export type { RunSourceOptions, RunSourceResult } from "./runSource";
