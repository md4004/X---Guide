import { expect, test, type Page } from "@playwright/test";

/**
 * The lesson workspace in the browser: code on the left, instructions on the right, one
 * step at a time.
 *
 * The engine-side proof lives in packages/validators/test/lesson.test.ts, which runs every
 * task's real solution through its real validators. This covers what that cannot: that the
 * authored MDX renders, that a step shows only its own prose, that the arrow gates on the
 * task actually being solved, and that a learner can get feedback, take a hint and pass.
 */

const TRACK = "/learn/xpp-fundamentals";
const LESSON_SLUG = "02-buffers-and-select";
const LESSON = `${TRACK}/${LESSON_SLUG}`;

/**
 * Step index within lesson 02. Steps are gated on their task, so a test that wants to
 * start deeper in the lesson seeds the earlier tasks as solved rather than solving them
 * again — see `startAt`.
 */
const STEPS = [
  { title: "A table buffer is a variable" },
  { title: "Read one record", taskId: "select-one-item" },
  { title: "When nothing matches" },
  { title: "Reading many records" },
  { title: "Loop a result set", taskId: "loop-furniture" },
  { title: "Reading is not writing" },
  { title: "Write what you read", taskId: "block-furniture" },
];

async function typeInto(page: Page, source: string) {
  await page.getByTestId("editor").locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press("ControlOrMeta+V");
}

/**
 * Opens the lesson with the workspace sitting on `index`.
 *
 * Every task before that point is pre-marked solved in localStorage — the same key the
 * app writes — so the arrows unlock and the walk is a handful of clicks rather than three
 * more engine runs per test.
 */
async function startAt(page: Page, index: number) {
  const solvedBefore = STEPS.slice(0, index).flatMap((step) =>
    step.taskId === undefined ? [] : [step.taskId],
  );

  await page.addInitScript(
    ({ lesson, taskIds }) => {
      for (const taskId of taskIds) {
        window.localStorage.setItem(`xpplab:progress:${lesson}:${taskId}`, "solved");
      }
    },
    { lesson: LESSON_SLUG, taskIds: solvedBefore },
  );

  await page.goto(LESSON);
  for (let step = 0; step < index; step++) {
    await page.getByTestId("step-next").click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STEPS[index]!.title);
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

test("the track index lists every lesson", async ({ page }) => {
  await page.goto(TRACK);

  await expect(page.getByRole("heading", { name: "X++ fundamentals" })).toBeVisible();

  for (const title of [
    "Output and variables",
    "Reading from the database",
    "Transactions",
    "Insert, update, delete",
    "Joins",
    "Set-based operations",
    "Companies",
    "Exceptions",
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await page.getByText("Output and variables", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Infolog");
});

test("nothing on the site assumes what the learner already knows", async ({ page }) => {
  // The track is for developers arriving from anywhere, so it is framed around no prior
  // platform. The old NAV/C-AL callouts are gone, and this is what keeps them gone.
  const priorPlatform = /C\/AL|\bNAV\b|Business Central/;

  await page.goto("/");
  await expect(page.getByText(priorPlatform)).toHaveCount(0);

  await page.goto(TRACK);
  await expect(page.getByText(priorPlatform)).toHaveCount(0);

  await page.goto(LESSON);
  await expect(page.getByText(priorPlatform)).toHaveCount(0);
});

test("one step is visible at a time", async ({ page }) => {
  await page.goto(LESSON);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A table buffer is a variable");

  // A later step's prose is in the document but renders nothing — <Step> shows only the
  // active one. This is the whole premise of the layout.
  await expect(page.getByText("When nothing matches")).toHaveCount(0);

  // A reading step is not gated, and it carries an example rather than an empty editor.
  await expect(page.getByTestId("check")).toHaveCount(0);
  await expect(page.getByTestId("step-next")).toBeEnabled();

  await page.getByTestId("step-next").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Read one record");
});

test("the arrow is locked until the step's task passes", async ({ page }) => {
  await startAt(page, 1);

  await expect(page.getByTestId("step-next")).toBeDisabled();
  await expect(page.getByTestId("check")).toBeEnabled({ timeout: 30_000 });

  await typeInto(
    page,
    `InventTable inventTable;

select firstonly inventTable
    where inventTable.ItemId == "F-100";

info(inventTable.ItemName);`,
  );
  await page.getByTestId("check").click();

  await expect(page.getByTestId("task-passed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("step-next")).toBeEnabled();

  // The pass survives a reload — progress is in localStorage, keyed by task.
  await page.reload();
  await page.getByTestId("step-next").click();
  await expect(page.getByTestId("step-next")).toBeEnabled();
});

test("a wrong answer gets the authored message, and its SQL", async ({ page }) => {
  await startAt(page, 1);
  await expect(page.getByTestId("check")).toBeEnabled({ timeout: 30_000 });

  // Right answer, expensive way: loops the whole table instead of selecting one.
  await typeInto(
    page,
    `InventTable inventTable;
while select inventTable
{
    if (inventTable.ItemId == "F-100")
    {
        info(inventTable.ItemName);
    }
}`,
  );
  await page.getByTestId("check").click();

  await expect(page.getByTestId("task-failed")).toContainText("walks the whole table", {
    timeout: 20_000,
  });

  // One message, not a list. A wall of red teaches nothing.
  await expect(page.getByTestId("task-failed")).toHaveCount(1);

  // And the SQL that earned it is one click away, on the same panel.
  await page.getByTestId("result-tab-sql").click();
  await expect(page.getByTestId("sql-trace")).toContainText("SELECT");
});

test("hints reveal progressively", async ({ page }) => {
  await startAt(page, 4);

  await expect(page.getByText("opens the cursor and loops")).toHaveCount(0);

  await page.getByTestId("hint").click();
  await expect(page.getByText("opens the cursor and loops")).toBeVisible();

  await page.getByTestId("hint").click();
  await expect(page.getByText("Increment your counter")).toBeVisible();
});

test("the answer unlocks only after three attempts", async ({ page }) => {
  await startAt(page, 1);
  await expect(page.getByTestId("check")).toBeEnabled({ timeout: 30_000 });

  await expect(page.getByRole("button", { name: "Show the answer" })).toHaveCount(0);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByTestId("check").click();
    await expect(page.getByTestId("task-failed")).toBeVisible({ timeout: 20_000 });
  }

  await expect(page.getByRole("button", { name: "Show the answer" })).toBeVisible();
});

test("one run does not leak into the next", async ({ page }) => {
  await startAt(page, 6);
  await expect(page.getByTestId("check")).toBeEnabled({ timeout: 30_000 });

  await typeInto(
    page,
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
  await page.getByTestId("check").click();
  await expect(page.getByTestId("task-passed")).toBeVisible({ timeout: 20_000 });

  // Run it again. If the runner had not restored the snapshot, the rows would already be
  // blocked and nothing would have changed — but it must still pass, because every attempt
  // starts from the same state.
  await page.getByTestId("check").click();
  await expect(page.getByTestId("task-passed")).toBeVisible({ timeout: 20_000 });
});

test("the forms lesson renders a form from metadata", async ({ page }) => {
  await page.goto("/learn/xpp-fundamentals/09-forms");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A form is metadata over a query",
  );

  // A reading step still has a Check-equivalent: run the example from the editor.
  await page.getByTestId("editor").locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(page.getByTestId("form-view")).toBeVisible({ timeout: 30_000 });

  // Enums render by label, never by their stored number — the single most misleading
  // thing the renderer could do.
  const grid = page.getByTestId("form-view").locator("table");
  await expect(grid).toContainText("Ashwood desk 1400");
  await expect(grid.locator("tbody")).toContainText("Yes");

  // And it says what it is, so nobody mistakes it for the real client.
  await expect(page.getByTestId("form-view")).toContainText("simulated");
});

test("the reports lesson renders grouped, totalled output", async ({ page }) => {
  await page.goto("/learn/xpp-fundamentals/10-reports");
  await page.getByTestId("step-next").click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fill the report table");
  await expect(page.getByTestId("check")).toBeEnabled({ timeout: 30_000 });

  await typeInto(
    page,
    `SalesLine salesLine;
InventTable inventTable;
TmpItemSales tmpItemSales;
int counter;

ttsbegin;
while select salesLine
    join inventTable
    where inventTable.ItemId == salesLine.ItemId
{
    tmpItemSales.clear();
    tmpItemSales.ItemGroupId = inventTable.ItemGroupId;
    tmpItemSales.ItemId = inventTable.ItemId;
    tmpItemSales.ItemName = inventTable.ItemName;
    tmpItemSales.SalesQty = salesLine.SalesQty;
    tmpItemSales.LineAmount = salesLine.LineAmount;
    tmpItemSales.insert();
    counter++;
}
ttscommit;

info(strFmt("Provider wrote %1 rows", counter));`,
  );
  await page.getByTestId("check").click();

  // The design grouped and totalled rows the provider wrote — built inside the run window,
  // before the task runner restored its snapshot. The panel opens straight onto it, which
  // is why the verdict is not what is on screen.
  const report = page.getByTestId("report-view");
  await expect(report).toBeVisible({ timeout: 20_000 });
  await expect(report).toContainText("FURNITURE");
  await expect(report).toContainText("19153");

  // The verdict is one tab away, and it did pass.
  await page.getByTestId("result-tab-result").click();
  await expect(page.getByTestId("task-passed")).toBeVisible();
  await expect(page.getByTestId("step-next")).toBeEnabled();
});
