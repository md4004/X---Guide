/**
 * @xpplab/xpp-lexer — tokenizer for the X++ v1 teaching subset.
 *
 * Hand-written, no generator. The parser needs error messages good enough to teach
 * with, and that starts here: the lexer reports what it saw and what it expected
 * instead of dying on the first surprise.
 */

import type { SourceSpan, XppError } from "@xpplab/xpp-core";

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

/**
 * Every reserved word in the v1 subset, and only those. X++ is case-insensitive for
 * keywords; the lexer lowercases before matching but preserves the original in
 * `Token.text`.
 *
 * Anything outside this list lexes as an identifier. Widening it is a subset change —
 * see docs/language-subset.md.
 */
export const XPP_KEYWORDS = [
  // Declarations and types
  "anytype",
  "boolean",
  "class",
  "container",
  "date",
  "enum",
  "extends",
  "guid",
  "implements",
  "int",
  "int64",
  "interface",
  "real",
  "str",
  "timeofday",
  "utcdatetime",
  "void",

  // Class members
  "abstract",
  "final",
  "new",
  "private",
  "protected",
  "public",
  "static",
  "super",
  "this",

  // Control flow
  "break",
  "case",
  "catch",
  "continue",
  "default",
  "do",
  "else",
  "for",
  "if",
  "retry",
  "return",
  "switch",
  "throw",
  "try",
  "while",

  // Select and DML
  "asc",
  "by",
  "crosscompany",
  "delete_from",
  "desc",
  "exists",
  "firstonly",
  "firstonly10",
  "firstonly100",
  "firstonly1000",
  "forupdate",
  "from",
  "group",
  "index",
  "insert_recordset",
  "join",
  "notexists",
  "order",
  "outer",
  "reverse",
  "select",
  "setting",
  "update_recordset",
  "where",

  // Select aggregates
  "avg",
  "count",
  "maxof",
  "minof",
  "sum",

  // Transactions
  "ttsabort",
  "ttsbegin",
  "ttscommit",

  // Company scoping
  "changecompany",

  // Chain of Command. Reserved so `next insert();` parses as a call down the chain
  // rather than as two identifiers in a row. `buffer.next()` still works, because a
  // keyword is allowed after `.`.
  "next",

  // Operators that are spelled as words
  "as",
  "div",
  "is",
  "like",
  "mod",
  "not",

  // Literals
  "false",
  "null",
  "true",
] as const;

export type XppKeyword = (typeof XPP_KEYWORDS)[number];

export const XPP_KEYWORD_SET: ReadonlySet<string> = new Set(XPP_KEYWORDS);

export function isKeyword(word: string): word is XppKeyword {
  return XPP_KEYWORD_SET.has(word.toLowerCase());
}

// ---------------------------------------------------------------------------
// Punctuators
// ---------------------------------------------------------------------------

/** Ordered longest-first so the maximal-munch scan can walk it directly. */
export const XPP_PUNCTUATORS = [
  ">>=",
  "<<=",
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "+=",
  "-=",
  "*=",
  "/=",
  "++",
  "--",
  "::",
  "=",
  "+",
  "-",
  "*",
  "/",
  "!",
  "~",
  "&",
  "|",
  "^",
  "<",
  ">",
  "?",
  ":",
  ";",
  ",",
  ".",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
] as const;

export type XppPunctuator = (typeof XPP_PUNCTUATORS)[number];

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TokenKind =
  | "identifier"
  | "keyword"
  | "punctuator"
  | "intLiteral"
  | "realLiteral"
  | "strLiteral"
  | "dateLiteral"
  | "trivia"
  | "eof";

export interface Token {
  kind: TokenKind;
  /** The exact source text, original casing preserved. */
  text: string;
  span: SourceSpan;
  /** Set when `kind === "keyword"`. Always lowercase. */
  keyword?: XppKeyword;
  /** Set when `kind === "punctuator"`. */
  punctuator?: XppPunctuator;
  /** Decoded literal value. `dateLiteral` decodes to an ISO `YYYY-MM-DD` string. */
  value?: string | number;
  /** Set when `kind === "trivia"`. Only present if `includeTrivia` was requested. */
  trivia?: TriviaKind;
}

export type TriviaKind = "whitespace" | "lineComment" | "blockComment";

export interface LexerOptions {
  /**
   * Emit whitespace and comments as `trivia` tokens. The parser does not want these;
   * the Monaco grammar and the formatter do. Default `false`.
   */
  includeTrivia?: boolean;
}

export interface LexResult {
  /** Always ends with a single `eof` token, even when `errors` is non-empty. */
  tokens: Token[];
  errors: XppError[];
}

/**
 * Tokenize a source string. Never throws: unrecognised input produces an error in
 * `errors` and the scan resumes at the next character so the parser still gets a
 * usable stream.
 */
export { tokenize } from "./lexer";
