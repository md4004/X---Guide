import { expect, test, type Page } from "@playwright/test";

/**
 * A scenario, driven the whole way through.
 *
 * The engine-side proof lives in `packages/scenarios/test` — that the release pipeline
 * refuses what the platform refuses, and that the authored solution passes its own
 * validators and every acceptance check. This covers what those cannot: that the four
 * phases actually gate, that the conversation records what you asked, that the AOT work
 * ticks itself off when you do it rather than when you say you did, and that the last
 * screen a learner sees is the change being live in production.
 */

const SCENARIO = "/scenarios/credit-hold";

const SOLUTION = `CustTable cust;
CustTrans trans;
SalesTable so;
SalesLine line;

ttsbegin;

while select forupdate cust
{
    real exposure = 0;

    while select trans
        where trans.AccountNum == cust.AccountNum
    {
        exposure += trans.AmountMST;
    }

    while select so
        where so.CustAccount == cust.AccountNum
           && so.SalesStatus == SalesStatus::Backorder
        join line
        where line.SalesId == so.SalesId
    {
        exposure += line.LineAmount;
    }

    if (exposure > cust.CreditMax * 1.10)
    {
        cust.Blocked = CustVendorBlocked::All;
        cust.update();
        error(strFmt("%1 is on hold: exposure %2 against a limit of %3",
            cust.AccountNum, exposure, cust.CreditMax));
    }
    else if (exposure > cust.CreditMax)
    {
        warning(strFmt("%1 is over its limit: exposure %2 against a limit of %3",
            cust.AccountNum, exposure, cust.CreditMax));
    }
}

ttscommit;
`;

async function open(page: Page) {
  await page.goto(SCENARIO);
  await expect(page.getByTestId("conversation")).toBeVisible();
}

/** Walks the brief, choosing `asked` where a choice is offered. */
async function runBrief(page: Page, asked: string[]) {
  for (let guard = 0; guard < 20; guard++) {
    const choices = page.getByTestId("choices");
    if (await choices.isVisible().catch(() => false)) {
      const buttons = choices.locator("button");
      const ids = await buttons.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid") ?? ""),
      );
      const wanted = ids.find((id) => asked.some((choice) => id === `choice-${choice}`)) ?? ids[0]!;
      await page.getByTestId(wanted.replace("choice-", "choice-")).click();
      continue;
    }

    if (await page.getByTestId("brief-closed").isVisible().catch(() => false)) return;
    await page.getByTestId("brief-continue").click();
  }
  throw new Error("the brief never closed");
}

async function doAotWork(page: Page) {
  // Right-click CustTable in Application Explorer — the panel's Add to project.
  await page.getByText("CustTable", { exact: true }).first().click({ button: "right" });
  await expect(page.getByTestId("aot-work-0")).toHaveAttribute("data-done", "true");

  // Open its designer, then read the two fields the code needs.
  await page.getByText("CustTable", { exact: true }).first().dblclick();
  await page.getByText("Blocked", { exact: true }).first().click();
  await expect(page.getByTestId("aot-work-1")).toHaveAttribute("data-done", "true");

  await page.getByText("CreditMax", { exact: true }).first().click();
  await expect(page.getByTestId("aot-work-2")).toHaveAttribute("data-done", "true");
}

async function typeSolution(page: Page) {
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(SOLUTION);
}

test.describe("the brief", () => {
  test("records what you asked, and marks what you did not", async ({ page }) => {
    await open(page);

    // Ask about exposure, then take the weak option on the threshold.
    await runBrief(page, ["ask-exposure", "assume-threshold", "ask-company"]);

    // The one they asked about reads as settled.
    const exposure = page.getByTestId("requirement-exposure");
    await expect(exposure).toContainText("open sales orders");

    // The one they assumed is flagged as learned late.
    await expect(page.getByTestId("requirement-threshold")).toContainText("You did not ask");
    await expect(page.getByTestId("requirements")).toContainText("learned late");
  });

  test("every reply advances — a weak answer is never a dead end", async ({ page }) => {
    await open(page);
    await runBrief(page, ["agree", "assume-threshold", "assume-company"]);

    await expect(page.getByTestId("brief-closed")).toBeVisible();
    await expect(page.getByTestId("phase-next")).toBeEnabled();
  });

  test("the choice you made is explained afterwards, whichever it was", async ({ page }) => {
    await open(page);
    await page.getByTestId("brief-continue").click();
    await page.getByTestId("choice-agree").click();

    await expect(page.getByTestId("choice-note").first()).toContainText("Balance");
  });
});

test.describe("the phases gate", () => {
  test("you cannot skip ahead of where you are", async ({ page }) => {
    await open(page);

    await expect(page.getByTestId("phase-build")).toBeDisabled();
    await expect(page.getByTestId("phase-release")).toBeDisabled();
    await expect(page.getByTestId("phase-next")).toBeDisabled();
  });

  test("build needs both the AOT work and passing code", async ({ page }) => {
    await open(page);
    await runBrief(page, ["ask-exposure", "ask-threshold", "ask-company"]);
    await page.getByTestId("phase-next").click();

    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });

    // Correct code, but the AOT work is untouched.
    await typeSolution(page);
    await page.getByTestId("check").click();
    await expect(page.getByTestId("task-passed")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("phase-next")).toBeDisabled();

    await doAotWork(page);
    await expect(page.getByTestId("phase-next")).toBeEnabled();
  });
});

test("the whole job, from the meeting to production", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);

  // 1. The brief.
  await runBrief(page, ["ask-exposure", "ask-threshold", "ask-company"]);
  await page.getByTestId("phase-next").click();

  // 2. Build it.
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await doAotWork(page);
  await typeSolution(page);
  await page.getByTestId("check").click();
  await expect(page.getByTestId("task-passed")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("phase-next").click();

  // 3. Prove it — every acceptance check, on one run.
  await page.getByTestId("run-acceptance").click();
  await expect(page.getByTestId("acceptance-results")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("check-other-company-untouched")).toHaveAttribute(
    "data-passed",
    "true",
  );
  await expect(page.getByTestId("acceptance-results")).toContainText("6 of 6 passing");
  await page.getByTestId("phase-next").click();

  // 4. Ship it. The wrong move first, because the refusal is the lesson.
  await expect(page.getByTestId("release-board")).toBeVisible();
  await page.getByTestId("release-create").click();
  await page.getByTestId("release-upload").click();

  // Applying before validation is refused, with the reason.
  await page.getByTestId("release-apply-sandbox").click();
  await expect(page.getByTestId("release-refusal")).toContainText("not passed validation");

  await page.getByTestId("release-validate").click();
  await page.getByTestId("release-apply-sandbox").click();
  await expect(page.getByTestId("release-note")).toContainText("Post-servicing");

  // Straight to production is refused with the rule that replaced it.
  await page.getByTestId("release-shortcut").click();
  await expect(page.getByTestId("release-refusal")).toContainText(
    "no longer apply packages directly to production",
  );

  // Promoting without sign-off is refused too.
  await page.getByTestId("release-mark-rc").click();
  await expect(page.getByTestId("release-refusal")).toContainText("signed off");

  await page.getByTestId("release-sign-off").click();
  await page.getByTestId("release-mark-rc").click();
  await page.getByTestId("release-schedule").click();

  await expect(page.getByTestId("scenario-finished")).toBeVisible();
  await expect(page.getByTestId("environment-production")).toContainText("version 2");
});
