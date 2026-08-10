/**
 * AST traversal.
 *
 * This is what `ast` validators run on, so it must visit every node — a validator that
 * silently fails to find a `whileSelect` because the walker skipped a branch would mark
 * a correct solution wrong, which is the worst failure mode this project has.
 *
 * Rather than a hand-written switch per node kind (which drifts the moment a node gains
 * a field), children are discovered structurally: any value under a node that looks like
 * a node is one.
 */

import type { Node, NodePath, SourceUnit, Statement, Visitor } from "./index";

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { span?: unknown }).span === "object"
  );
}

/** Direct children, in source order. */
export function childrenOf(node: Node): Node[] {
  const children: Node[] = [];

  for (const value of Object.values(node)) {
    if (isNode(value)) {
      children.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) children.push(item);
      }
    }
  }

  // Object key order is declaration order for string keys, which matches source order
  // closely enough for traversal, but not exactly. Sort by position to be certain.
  return children.sort((a, b) => a.span.start.offset - b.span.start.offset);
}

export function walk(root: Node, visitor: Visitor): void {
  const ancestors: Node[] = [];

  const visit = (node: Node): void => {
    const path: NodePath = {
      ancestors: [...ancestors],
      ...(ancestors.length > 0 ? { parent: ancestors[ancestors.length - 1]! } : {}),
      depth: ancestors.length,
    };

    const wildcard = visitor["*"]?.enter?.(node, path);
    // A hook returning false prunes the subtree.
    if (wildcard === false) return;

    const hooks = visitor[node.kind] as
      | {
          enter?: (node: Node, path: NodePath) => boolean | void;
          exit?: (node: Node, path: NodePath) => void;
        }
      | undefined;

    if (hooks?.enter?.(node, path) === false) return;

    ancestors.push(node);
    for (const child of childrenOf(node)) visit(child);
    ancestors.pop();

    hooks?.exit?.(node, path);
  };

  visit(root);
}

export function findAll<K extends Node["kind"]>(root: Node, kind: K): Extract<Node, { kind: K }>[] {
  const found: Extract<Node, { kind: K }>[] = [];
  walk(root, {
    "*": {
      enter: (node) => {
        if (node.kind === kind) found.push(node as Extract<Node, { kind: K }>);
      },
    },
  });
  return found;
}

/**
 * Does `node` sit between a `ttsbegin` and a `ttscommit`?
 *
 * Backs the `wrappedIn: "transaction"` validator. This is a *source-order* question, not
 * a nesting one: `ttsbegin` and `ttscommit` are sibling statements, not a block, so
 * "inside a transaction" means "after a ttsbegin and before its matching ttscommit".
 *
 * Statements inside a loop or an `if` that sits between the two count, which is why the
 * comparison is on source offsets rather than on the statement list.
 */
export function isInsideTransaction(root: SourceUnit, node: Statement): boolean {
  const begins = findAll(root, "ttsBegin").map((n) => n.span.start.offset);
  const commits = findAll(root, "ttsCommit").map((n) => n.span.end.offset);
  const aborts = findAll(root, "ttsAbort").map((n) => n.span.end.offset);
  const closers = [...commits, ...aborts].sort((a, b) => a - b);

  const target = node.span.start.offset;

  // Walk the begins that open before the target and find one whose matching closer
  // comes after it. Depth counting handles nesting.
  let depth = 0;
  const events = [
    ...begins.map((offset) => ({ offset, delta: 1 })),
    ...closers.map((offset) => ({ offset, delta: -1 })),
  ].sort((a, b) => a.offset - b.offset);

  for (const event of events) {
    if (event.offset > target) break;
    depth += event.delta;
  }

  return depth > 0;
}
