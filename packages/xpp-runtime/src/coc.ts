/**
 * Chain of Command: `[ExtensionOf]`, method wrapping, and `next`.
 *
 * This is the mechanism the whole customisation model rests on, and the one people get
 * wrong most reliably. Three facts drive everything here, all of them sourced (VB-061 to
 * VB-067):
 *
 * 1. **A wrapper must call `next`**, and the call has to be a first-level statement. Not
 *    inside an `if`, not in a loop, not after a `return`. The compiler enforces it, so
 *    this engine enforces it before a line runs rather than at the moment of the call.
 *
 * 2. **The order among wrappers is not defined.** Microsoft's own words: the system
 *    "randomly runs one of these methods", and on `next` "randomly picks another method
 *    in the CoC". Code that depends on running first or last is already broken; it just
 *    has not been caught yet.
 *
 * 3. **Only the chain's tail is the original.** Everything before it is somebody's
 *    extension, and any of them can quietly swallow the result by ignoring what `next`
 *    returned. That compiles. It is the defect the lesson is built around.
 *
 * Because of (2) this module deliberately does *not* offer a way to order wrappers. It
 * runs them in declaration order because it has to run them in some order, and both the
 * visualiser and the lesson say out loud that the order is not a guarantee.
 */

import type { ClassDeclaration, Expression, MethodDeclaration } from "@xpplab/xpp-parser";

/** What an `[ExtensionOf(...)]` attribute pointed at. */
export interface ExtensionTarget {
  kind: "class" | "table" | "form";
  name: string;
}

export interface WrapperMethod {
  /** The extension class that declares the wrapper. */
  extensionClass: string;
  declaration: MethodDeclaration;
}

export class CocError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/**
 * Reads the name out of a compile-time function used inside an attribute.
 *
 * `classStr(Foo)` and `tableStr(Foo)` are resolved by the compiler, so their argument is a
 * *name* rather than a value and cannot be evaluated. Reading it structurally is what the
 * compiler does too.
 */
function nameFromArgument(argument: Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;

  if (argument.kind === "identifier") return argument.name;
  if (argument.kind === "literal") return String(argument.value);

  if (argument.kind === "call" && argument.callee.kind === "identifier") {
    return nameFromArgument(argument.arguments[0]);
  }

  return undefined;
}

/** `[ExtensionOf(classStr(X))]` → what it extends, or `undefined` if it is not one. */
export function extensionTargetOf(declaration: ClassDeclaration): ExtensionTarget | undefined {
  const attribute = declaration.attributes.find(
    (candidate) => candidate.name.toLowerCase() === "extensionof",
  );
  if (attribute === undefined) return undefined;

  const argument = attribute.arguments[0];
  const name = nameFromArgument(argument);

  if (name === undefined) {
    throw new CocError(
      `The [ExtensionOf] on '${declaration.name}' does not name anything.`,
      "Write it as `[ExtensionOf(classStr(TheClass))]` — the argument is a name resolved when the code is compiled, not a string you build at runtime.",
    );
  }

  const inner =
    argument?.kind === "call" && argument.callee.kind === "identifier"
      ? argument.callee.name.toLowerCase()
      : "classstr";

  const kind = inner === "tablestr" ? "table" : inner === "formstr" ? "form" : "class";

  // VB-062. The rule exists because an extension class is never instantiated or derived
  // from — it only contributes methods — so anything else is a misunderstanding worth
  // catching early.
  if (!declaration.modifiers.includes("final")) {
    throw new CocError(
      `'${declaration.name}' is an extension class, so it must be declared \`final\`.`,
      "Write `[ExtensionOf(...)] final class YourName_Extension`. An extension is never instantiated or subclassed; `final` is how the compiler is told that.",
    );
  }

  return { kind, name };
}

// ---------------------------------------------------------------------------
// The `next` rules
// ---------------------------------------------------------------------------

/**
 * Whether a `next` for `methodName` sits where the compiler demands.
 *
 * "The call to **next** must be in the first-level statements in the method body" — so
 * this looks only at the top level of the body, plus the inside of a `try`, which
 * Platform update 21 allows.
 */
function findTopLevelNext(method: MethodDeclaration): boolean {
  const statements = method.body.statements;

  const isNext = (statement: (typeof statements)[number]): boolean => {
    if (statement.kind === "nextCall") return true;

    // `ret = next validateWrite();` and `str s = next speak();` — the call is inside the
    // statement's expression rather than being the statement.
    if (statement.kind === "expressionStatement" || statement.kind === "variableDeclaration") {
      return containsNext(statement as unknown as { [key: string]: unknown });
    }

    /**
     * `return next speak();`.
     *
     * The documented rule is that "a **return** statement can't precede a **next**
     * statement" — a `return` *before* the next, which would skip it. A return whose value
     * *is* the next call does not skip anything: the chain runs, and its answer is what
     * comes back. It satisfies the purpose of the rule, which is that `next` is guaranteed
     * to execute. Logged in docs/unverified.md, because the documentation does not spell
     * this form out either way.
     */
    if (statement.kind === "return") {
      return containsNext(statement as unknown as { [key: string]: unknown });
    }

    // PU21: a `next` inside try/catch/finally is allowed.
    if (statement.kind === "tryCatch") {
      return statement.block.statements.some(isNext);
    }

    return false;
  };

  return statements.some(isNext);
}

/** Structural search for a `nextCall` anywhere inside a node. */
function containsNext(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;

  if (Array.isArray(node)) return node.some(containsNext);

  const record = node as Record<string, unknown>;
  if (record["kind"] === "nextCall" || record["kind"] === "nextExpression") return true;

  return Object.values(record).some(containsNext);
}

/** Whether a `next` appears anywhere at all, including where it is not allowed. */
function hasNextAnywhere(method: MethodDeclaration): boolean {
  return containsNext(method.body as unknown);
}

export interface WrapperCheckOptions {
  /** `true` when the wrapped base method carries `[Replaceable]`. */
  replaceable: boolean;
}

/**
 * The compile-time rules for a wrapper, checked before anything runs.
 *
 * Reporting these at the moment of the call would teach the wrong model of when you find
 * out. In a real environment none of this code would build.
 */
export function checkWrapper(
  extensionClass: string,
  method: MethodDeclaration,
  options: WrapperCheckOptions,
): void {
  if (options.replaceable) return;

  if (!hasNextAnywhere(method)) {
    throw new CocError(
      `'${extensionClass}.${method.name}' wraps a method but never calls \`next\`.`,
      "A wrapper must always call `next`, so the rest of the chain and finally the original implementation still run. Without it you have silently replaced everyone else's code.",
    );
  }

  if (!findTopLevelNext(method)) {
    throw new CocError(
      `'${extensionClass}.${method.name}' calls \`next\`, but not as a first-level statement.`,
      "`next` cannot sit inside an `if`, a loop, or after a `return` — the compiler has to be able to guarantee it runs. A `try` block is the one exception.",
    );
  }
}

// ---------------------------------------------------------------------------
// The resolved chain
// ---------------------------------------------------------------------------

export type ChainLinkKind = "preHandler" | "wrapper" | "base" | "postHandler";

export interface ChainLink {
  kind: ChainLinkKind;
  /** The class contributing this link — an extension, a handler class, or the target. */
  declaringClass: string;
  methodName: string;
}

export interface ResolvedChain {
  target: string;
  methodName: string;
  links: ChainLink[];
  /**
   * `true` when more than one wrapper contributes, which is exactly when the order stops
   * being knowable. The visualiser says so rather than drawing a confident sequence.
   */
  orderIsUndefined: boolean;
}
