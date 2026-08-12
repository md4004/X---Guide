/**
 * @xpplab/xpp-core — shared primitives.
 *
 * Types only, plus a couple of trivial constructors. Nothing in here executes learner
 * code or touches a database. Every other engine package depends on this one; this one
 * depends on nothing.
 */

// ---------------------------------------------------------------------------
// Source positions
// ---------------------------------------------------------------------------

/** A 1-based line/column position, plus the 0-based offset into the source string. */
export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

/** A half-open range `[start, end)` in the learner's source. */
export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type XppSeverity = "error" | "warning";

/**
 * The only failure shape the UI ever sees. The interpreter never throws a raw JS error
 * across the package boundary (see CLAUDE.md > Engine conventions).
 *
 * `code` is stable and greppable; `message` mirrors the wording a real compiler or AOS
 * would produce; `hint` is ours, and is the part that teaches.
 */
export interface XppError {
  code: XppErrorCode;
  message: string;
  line: number;
  column: number;
  /** Present when the error covers a range worth underlining in the editor. */
  endLine?: number;
  endColumn?: number;
  hint?: string;
  severity?: XppSeverity;
}

/**
 * The error-code registry. Codes are grouped by originating layer so a learner-facing
 * code is enough to tell you which package raised it.
 *
 * - `XL` lexer, `XP` parser, `XR` runtime, `XD` database, `XA` AOT metadata.
 *
 * Phases 2 and 3 fill this out; the shape is frozen now so error text can be authored
 * alongside the implementation rather than after it.
 */
export const XppErrorCodes = {
  // Lexer
  UnterminatedString: "XL001",
  UnexpectedCharacter: "XL002",
  InvalidNumericLiteral: "XL003",
  UnterminatedComment: "XL004",

  // Parser
  UnexpectedToken: "XP001",
  ExpectedToken: "XP002",
  ExpectedExpression: "XP003",
  ExpectedStatement: "XP004",
  ExpectedDeclaration: "XP005",
  ConstructOutsideSubset: "XP100",

  // Runtime
  UndeclaredIdentifier: "XR001",
  TypeMismatch: "XR002",
  DivideByZero: "XR003",
  NullReference: "XR004",
  MethodNotFound: "XR005",
  UpdateOutsideTransaction: "XR100",
  BufferNotSelectedForUpdate: "XR101",
  UncommittedDataAtEndOfRun: "XR102",
  TransactionNotStarted: "XR103",
  DeadlockException: "XR104",
  UpdateConflictException: "XR105",
  UnhandledException: "XR106",
  ExecutionTimeout: "XR200",
  StatementBudgetExceeded: "XR201",

  // Database
  TableNotFound: "XD001",
  FieldNotFound: "XD002",
  DuplicateKey: "XD003",
  CompanyNotFound: "XD004",

  // AOT metadata
  ObjectNotFound: "XA001",
  ExtensionTargetNotFound: "XA002",
  NextNotCalled: "XA003",
} as const;

export type XppErrorCode = (typeof XppErrorCodes)[keyof typeof XppErrorCodes];

/** Convenience constructor so call sites stay one line. */
export function createError(
  code: XppErrorCode,
  message: string,
  at: SourcePosition | SourceSpan,
  hint?: string,
): XppError {
  const start = "start" in at ? at.start : at;
  const error: XppError = { code, message, line: start.line, column: start.column };
  if ("end" in at) {
    error.endLine = at.end.line;
    error.endColumn = at.end.column;
  }
  if (hint !== undefined) error.hint = hint;
  return error;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Every fallible engine entry point returns this rather than throwing. Errors are a
 * list because the parser reports as many as it can recover from in one pass.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; errors: XppError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(errors: XppError[]): Result<T> {
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Infolog
// ---------------------------------------------------------------------------

export type InfologType = "info" | "warning" | "error";

/** One line in the Infolog panel, in emission order. */
export interface InfologEntry {
  type: InfologType;
  message: string;
  /** 0-based emission order, so the UI can render stably without array identity. */
  sequence: number;
  /** Source line of the `info()`/`warning()`/`error()` call, when known. */
  line?: number;
  /**
   * Nesting depth, for the indented sub-entries a real Infolog shows under an
   * exception. Zero for a top-level line.
   */
  depth?: number;
}

// ---------------------------------------------------------------------------
// SQL trace
// ---------------------------------------------------------------------------

export type SqlStatementKind =
  "select" | "insert" | "update" | "delete" | "savepoint" | "release" | "rollback";

/**
 * One entry in the SQL trace panel. This is a headline learner-facing feature, not
 * debug output (see CLAUDE.md) — every field here is rendered.
 */
export interface SqlTraceEntry {
  sequence: number;
  kind: SqlStatementKind;
  /** Parameterised SQL, exactly as handed to sql.js. Never inline the parameters. */
  sql: string;
  parameters: SqlValue[];
  /** Rows returned by a select, or rows affected by a write. */
  rowCount: number;
  /** Source line of the X++ statement that generated this, when known. */
  sourceLine?: number;
  /** Transaction nesting depth at the time this ran. */
  transactionDepth: number;
}

/** The value types that cross the sql.js boundary. */
export type SqlValue = string | number | null | Uint8Array;

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/**
 * A legal entity id — `DATAAREAID` in the schema. Company scoping is real in this
 * engine because it is one of the highest-value concepts for the NAV/BC audience.
 */
export type CompanyId = string;

// ---------------------------------------------------------------------------
// Execution budget
// ---------------------------------------------------------------------------

/** The runner contract from docs/lesson-schema.md, expressed once. */
export const EXECUTION_LIMITS = {
  /** Wall-clock ceiling for a single run, in milliseconds. */
  timeoutMs: 3_000,
  /** Interpreter statement cap, to stop runaway loops before the timeout does. */
  maxStatements: 100_000,
  /**
   * Method call depth, to stop unbounded recursion.
   *
   * Separate from the statement cap because recursion that does almost nothing per frame
   * would exhaust the JavaScript stack long before it executed 100,000 statements, and a
   * host stack overflow is not something the engine can turn into a teaching error.
   */
  maxCallDepth: 256,
} as const;
