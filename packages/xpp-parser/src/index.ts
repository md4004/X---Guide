/**
 * @xpplab/xpp-parser — recursive descent over the token stream, no generator.
 *
 * The parser recovers: it reports an error, skips to the next plausible statement
 * boundary, and keeps going, so a learner with three mistakes sees three markers rather
 * than one.
 */

import type { Node } from "./ast.js";

export * from "./ast.js";
export { parse, parseExpression } from "./parser.js";
export type { ParseResult, ParserOptions } from "./parser.js";
export { walk, findAll, isInsideTransaction, childrenOf } from "./walk.js";

// ---------------------------------------------------------------------------
// Traversal types
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
