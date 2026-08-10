/**
 * @xpplab/xpp-parser — recursive descent over the token stream, no generator.
 *
 * The parser recovers: it reports an error, skips to the next plausible statement
 * boundary, and keeps going, so a learner with three mistakes sees three markers rather
 * than one.
 */

import type { XppError } from "@xpplab/xpp-core";
import type { Token } from "@xpplab/xpp-lexer";
import type { Node, SourceUnit, Expression, Statement } from "./ast.js";

export * from "./ast.js";

export interface ParserOptions {
  /**
   * Stop after this many errors and bail out. Prevents a pathological input from
   * producing a wall of red. Default 25.
   */
  maxErrors?: number;
}

export interface ParseResult {
  /** `null` only when the source could not be recovered into any usable tree. */
  ast: SourceUnit | null;
  errors: XppError[];
  /** The token stream, retained for the editor's syntax highlighting and hover. */
  tokens: Token[];
}

/**
 * Parse a full source unit — a job body, one or more class declarations, or both.
 * Never throws.
 */
export function parse(_source: string, _options?: ParserOptions): ParseResult {
  throw new Error("not implemented");
}

/** Parse a single expression. Used by the watch panel, not by lesson running. */
export function parseExpression(_source: string, _options?: ParserOptions): Expression | null {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * A visitor keyed by node kind. Both hooks are optional per kind; `enter` returning
 * `false` skips that node's children.
 */
export type Visitor = {
  [K in Node["kind"]]?: {
    enter?: (node: Extract<Node, { kind: K }>, path: NodePath) => boolean | void;
    exit?: (node: Extract<Node, { kind: K }>, path: NodePath) => void;
  };
} & {
  /** Called for every node, before the kind-specific hook. */
  "*"?: { enter?: (node: Node, path: NodePath) => boolean | void };
};

export interface NodePath {
  /** Ancestors, outermost first. Does not include the node itself. */
  ancestors: Node[];
  parent?: Node;
  depth: number;
}

/** Depth-first walk in source order. */
export function walk(_root: Node, _visitor: Visitor): void {
  throw new Error("not implemented");
}

/** Collect every node of a given kind. The workhorse behind `ast` validators. */
export function findAll<K extends Node["kind"]>(
  _root: Node,
  _kind: K,
): Extract<Node, { kind: K }>[] {
  throw new Error("not implemented");
}

/**
 * Does `node` sit anywhere inside a `ttsbegin`/`ttscommit` pair?
 * Backs the `wrappedIn: "transaction"` validator.
 */
export function isInsideTransaction(_root: SourceUnit, _node: Statement): boolean {
  throw new Error("not implemented");
}
