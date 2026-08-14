/**
 * The wrong answers, and the message each one earns.
 *
 * A validator that cannot fail teaches nothing, and the repo has shipped two of those
 * before — one asserted a select modifier against a keyword that was not one, and one
 * named an AST node kind that did not exist. Both passed everything, forever, silently.
 *
 * So every validator on a scenario gets an answer written specifically to trip it, and
 * the test asserts the learner is told the *right* thing, not merely that they failed.
 */

import { describe, expect, it } from "vitest";
import { createVirtualDb } from "@xpplab/virtual-db";
import { runTask } from "@xpplab/validators";
import { creditHold } from "../../../content/scenarios/credit-hold";

/** The solution, with one thing changed. Keeps each case to its single difference. */
function variant(replacements: [string, string][]): string {
  let source = creditHold.task.solution;
  for (const [from, to] of replacements) {
    if (!source.includes(from)) {
      throw new Error(`the solution no longer contains ${JSON.stringify(from)}`);
    }
    source = source.split(from).join(to);
  }
  return source;
}

async function check(source: string): Promise<{ passed: boolean; message: string }> {
  const db = createVirtualDb();
  await db.init();
  await db.reset(creditHold.seed);
  await db.setCompany(creditHold.company);

  const outcome = await runTask({ task: creditHold.task, source, db });
  await db.close();

  return {
    passed: outcome.passed,
    message:
      outcome.failure?.validator.message ??
      outcome.runtimeErrors[0]?.message ??
      outcome.parseErrors[0]?.message ??
      "",
  };
}

describe("credit-hold wrong answers", () => {
  it("reaching across companies is caught, and named", async () => {
    const result = await check(variant([["while select forupdate cust", "while select crosscompany forupdate cust"]]));

    expect(result.passed).toBe(false);
    expect(result.message).toContain("crosscompany");
    expect(result.message).toContain("Kelton");
  });

  it("counting only the posted balance misses the customer the meeting was about", async () => {
    const result = await check(
      variant([
        [
          `    // Orders that have not shipped yet still count against the limit.
    while select so
        where so.CustAccount == cust.AccountNum
           && so.SalesStatus == SalesStatus::Backorder
        join line
        where line.SalesId == so.SalesId
    {
        exposure += line.LineAmount;
    }
`,
          "",
        ],
      ]),
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain("C-300");
    expect(result.message).toContain("unshipped orders");
  });

  it("blocking everyone who is over at all stops the customer sales protect", async () => {
    const result = await check(variant([["cust.CreditMax * 1.10", "cust.CreditMax"]]));

    expect(result.passed).toBe(false);
    expect(result.message).toContain("C-200");
    expect(result.message).toContain("8%");
  });

  it("counting only what has been ordered but not shipped misses the customer with no open orders", async () => {
    const result = await check(
      variant([
        [
          `    // Posted, unpaid invoices.
    while select trans
        where trans.AccountNum == cust.AccountNum
    {
        exposure += trans.AmountMST;
    }
`,
          "",
        ],
      ]),
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain("C-400");
    expect(result.message).toContain("posted invoices alone");
  });

  it("putting everybody on hold is caught by the customer who is nowhere near their limit", async () => {
    const result = await check(
      variant([["if (exposure > cust.CreditMax * 1.10)", "if (true)"]]),
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain("C-100");
  });

  it("writing outside a transaction is refused", async () => {
    const result = await check(variant([["ttsbegin;", ""], ["ttscommit;", ""]]));

    expect(result.passed).toBe(false);
    // Either the AST validator or the runtime catches it. Both are correct answers; what
    // must not happen is a silent pass.
    expect(result.message.toLowerCase()).toContain("transaction");
  });

  it("logging the hold without the numbers fails the evidence requirement", async () => {
    const result = await check(
      variant([
        [
          `error(strFmt("%1 is on hold: exposure %2 against a limit of %3",
            cust.AccountNum, exposure, cust.CreditMax));`,
          `error(strFmt("%1 is on hold", cust.AccountNum));`,
        ],
      ]),
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain("number that triggered");
  });
});
