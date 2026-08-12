/**
 * `ast` validators.
 *
 * These prove *how* a learner solved it, not just that the numbers came out right. A
 * task that only checks the final rows accepts a nested loop where the lesson was about
 * `while select`, and the learner walks away having practised the wrong thing.
 */

import { findAll, isInsideTransaction, walk } from "@xpplab/xpp-parser";
import type { NodeKind, SourceUnit, Statement } from "@xpplab/xpp-parser";
import type { AstValidator } from "./types";

/** Statements that write to the database — what `wrappedIn: "transaction"` is about. */
const MUTATING_STATEMENTS: NodeKind[] = ["insertRecordset", "updateRecordset", "deleteFrom"];

/** Buffer methods that write. `custTable.insert()` is a mutation; `.clear()` is not. */
const MUTATING_METHODS = new Set([
  "insert",
  "update",
  "delete",
  "doinsert",
  "doupdate",
  "dodelete",
]);

export function evaluateAst(validator: AstValidator, ast: SourceUnit): boolean {
  switch (validator.rule) {
    case "usesStatement":
      return findAll(ast, validator.value).length > 0;

    case "forbids":
      return findAll(ast, validator.value).length === 0;

    case "usesModifier":
      return findAll(ast, "selectClauses").some((clauses) =>
        clauses.modifiers.includes(validator.value),
      );

    case "wrappedIn":
      return everyMutationIsInATransaction(ast);

    case "callsMethod":
      return callsMethod(ast, validator.value);

    case "declaresExtension":
      return declaresExtension(ast, validator.value);
  }
}

/**
 * Every write sits inside a `ttsbegin`/`ttscommit` pair.
 *
 * "Every", not "any": a learner who wraps one of two updates has not understood the
 * rule, and passing them would teach that partial coverage is fine.
 *
 * A program with no writes at all fails this — the validator is only ever attached to a
 * task that asks for a write, so "nothing to wrap" means "nothing was written".
 */
function everyMutationIsInATransaction(ast: SourceUnit): boolean {
  const mutations: Statement[] = [];

  for (const kind of MUTATING_STATEMENTS) {
    mutations.push(...(findAll(ast, kind) as Statement[]));
  }

  // Buffer method calls are expressions, so the enclosing statement is what gets tested.
  walk(ast, {
    expressionStatement: {
      enter: (statement) => {
        const expression = statement.expression;
        if (expression.kind !== "call") return;
        if (expression.callee.kind !== "memberAccess") return;
        if (!MUTATING_METHODS.has(expression.callee.member.toLowerCase())) return;
        mutations.push(statement);
      },
    },
  });

  if (mutations.length === 0) return false;
  return mutations.every((statement) => isInsideTransaction(ast, statement));
}

function callsMethod(ast: SourceUnit, name: string): boolean {
  const target = name.toLowerCase();
  let found = false;

  walk(ast, {
    call: {
      enter: (call) => {
        if (call.callee.kind === "memberAccess" && call.callee.member.toLowerCase() === target) {
          found = true;
        }
        if (call.callee.kind === "identifier" && call.callee.name.toLowerCase() === target) {
          found = true;
        }
        // `Tally::report()`. The parser shapes `::` as enum access, because at parse time
        // `NoYes::Yes` and `Tally::report()` are indistinguishable — only the call around
        // it says which. A static call is still a method call, and a validator that missed
        // it would quietly pass any task about calling one.
        if (call.callee.kind === "enumAccess" && call.callee.valueName.toLowerCase() === target) {
          found = true;
        }
      },
    },
    // `next insert();` is its own statement, not a call expression.
    nextCall: {
      enter: (statement) => {
        if (target === "next" || statement.methodName.toLowerCase() === target) found = true;
      },
    },
  });

  return found;
}

/**
 * `[ExtensionOf(tableStr(InventTable))]` targets the right object.
 *
 * The attribute argument is a call like `tableStr(InventTable)`, so the target name is
 * the identifier inside it.
 */
function declaresExtension(ast: SourceUnit, target: string): boolean {
  const wanted = target.toLowerCase();

  return ast.declarations.some((declaration) =>
    declaration.attributes.some((attribute) => {
      if (attribute.name.toLowerCase() !== "extensionof") return false;
      return attribute.arguments.some((argument) => {
        if (argument.kind === "identifier") return argument.name.toLowerCase() === wanted;
        if (argument.kind !== "call") return false;
        return argument.arguments.some(
          (inner) => inner.kind === "identifier" && inner.name.toLowerCase() === wanted,
        );
      });
    }),
  );
}

/** Extra context for the failure UI — what was found instead of what was wanted. */
export function describeAstFailure(
  validator: AstValidator,
  ast: SourceUnit,
): Record<string, unknown> {
  switch (validator.rule) {
    case "usesStatement":
    case "forbids":
      return {
        wanted: validator.value,
        statementsFound: [...new Set(ast.statements.map((statement) => statement.kind))],
      };
    case "usesModifier":
      return {
        wanted: validator.value,
        modifiersFound: findAll(ast, "selectClauses").flatMap((clauses) => clauses.modifiers),
      };
    default:
      return { rule: validator.rule, wanted: validator.value };
  }
}
