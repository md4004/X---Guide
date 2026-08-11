import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5's acceptance criterion in the browser: one lesson authored in MDX, with three
 * tasks, and both the passing and failing paths correct.
 *
 * The engine-side proof lives in packages/validators/test/lesson.test.ts, which runs
 * every task's real solution through its real validators. This covers what that cannot:
 * that the authored MDX actually renders, that the tasks appear where the author put
 * them, and that a learner can get feedback, take a hint and pass.
 */

const LESSON = "/learn/xpp-for-nav-devs/02-buffers-and-select";

async function typeInto(page: Page, testId: string, source: string) {
  const task = page.getByTestId(testId);
  await task.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press("ControlOrMeta+V");
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // Progress persists in localStorage, so each test starts from a clean slate. Guarded
  // by a sessionStorage flag because an init script re-runs on every navigation — an
  // unguarded clear would wipe the progress the reload test is checking survived.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("e2e:cleared") === null) {
      window.localStorage.clear();
      window.sessionStorage.setItem("e2e:cleared", "1");
    }
  });
});

test("the lesson renders its prose, callout and three tasks", async ({ page }) => {
  await page.goto(LESSON);

  await expect(page.getByRole("heading", { name: "Buffers and select" })).toBeVisible();
  await expect(page.getByText("By the end you will")).toBeVisible();

  // Exactly one NavCallout, per the authoring checklist.
  await expect(page.getByText("Coming from NAV")).toHaveCount(1);

  // The Compare component puts C/AL and X++ side by side.
  await expect(page.getByText("C/AL", { exact: true })).toBeVisible();

  for (const id of ["select-one-item", "loop-furniture", "block-furniture"]) {
    await expect(page.getByTestId(`task-${id}`)).toBeVisible();
  }

  await expect(page.getByTestId("lesson-progress")).toContainText("0 of 3 tasks solved");
});

test("a wrong answer gets the authored message, not a generic failure", async ({ page }) => {
  await page.goto(LESSON);
  await expect(page.getByTestId("check-select-one-item")).toBeEnabled({ timeout: 30_000 });

  // Right answer, expensive way: loops the whole table instead of selecting one.
  await typeInto(
    page,
    "task-select-one-item",
    `InventTable inventTable;
while select inventTable
{
    if (inventTable.ItemId == "F-100")
    {
        info(inventTable.ItemName);
    }
}`,
  );

  await page.getByTestId("check-select-one-item").click();

  const task = page.getByTestId("task-select-one-item");
  await expect(task.getByTestId("task-failed")).toContainText("walks the whole table", {
    timeout: 20_000,
  });

  // One message, not a list. A wall of red teaches nothing.
  await expect(task.getByTestId("task-failed")).toHaveCount(1);
});

test("hints reveal progressively", async ({ page }) => {
  await page.goto(LESSON);
  const task = page.getByTestId("task-loop-furniture");

  await expect(task.getByText("while select", { exact: false })).toHaveCount(0);

  await page.getByTestId("hint-loop-furniture").click();
  await expect(task.getByText("opens the cursor and loops")).toBeVisible();

  await page.getByTestId("hint-loop-furniture").click();
  await expect(task.getByText("Increment your counter")).toBeVisible();
});

test("the solution unlocks only after three attempts", async ({ page }) => {
  await page.goto(LESSON);
  await expect(page.getByTestId("check-block-furniture")).toBeEnabled({ timeout: 30_000 });

  const task = page.getByTestId("task-block-furniture");
  await expect(task.getByRole("button", { name: "Show solution" })).toHaveCount(0);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByTestId("check-block-furniture").click();
    await expect(task.getByTestId("task-failed")).toBeVisible({ timeout: 20_000 });
  }

  await expect(task.getByRole("button", { name: "Show solution" })).toBeVisible();
});

test("the correct answer passes and progress is recorded", async ({ page }) => {
  await page.goto(LESSON);
  await expect(page.getByTestId("check-select-one-item")).toBeEnabled({ timeout: 30_000 });

  await typeInto(
    page,
    "task-select-one-item",
    `InventTable inventTable;

select firstonly inventTable
    where inventTable.ItemId == "F-100";

info(inventTable.ItemName);`,
  );

  await page.getByTestId("check-select-one-item").click();

  const task = page.getByTestId("task-select-one-item");
  await expect(task.getByTestId("task-passed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("lesson-progress")).toContainText("1 of 3 tasks solved");

  // The pass survives a reload — progress is in localStorage.
  await page.reload();
  await expect(page.getByTestId("lesson-progress")).toContainText("1 of 3 tasks solved");
});

test("one task's run does not leak into the next", async ({ page }) => {
  await page.goto(LESSON);
  await expect(page.getByTestId("check-block-furniture")).toBeEnabled({ timeout: 30_000 });

  // Solve the blocking task, which updates four rows.
  await typeInto(
    page,
    "task-block-furniture",
    `InventTable inventTable;
int counter;

ttsbegin;
while select forupdate inventTable
    where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
ttscommit;

info(strFmt("Blocked %1 items", counter));`,
  );
  await page.getByTestId("check-block-furniture").click();
  await expect(page.getByTestId("task-block-furniture").getByTestId("task-passed")).toBeVisible({
    timeout: 20_000,
  });

  // Now solve it again. If the runner had not restored the snapshot, the rows would
  // already be blocked and nothing would have changed the second time — but the task
  // must still pass, because every attempt starts from the same state.
  await page.getByTestId("check-block-furniture").click();
  await expect(page.getByTestId("task-block-furniture").getByTestId("task-passed")).toBeVisible({
    timeout: 20_000,
  });
});
