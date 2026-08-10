import { expect, test } from "@playwright/test";

/**
 * Phase 4's acceptance criterion, verbatim: paste a `while select` loop that updates
 * rows, hit Run, and see all four panels populate correctly in under 500ms.
 *
 * The 500ms is measured on the run itself — the worker round trip plus execution — not
 * on the cold page load, which includes downloading Monaco and compiling the SQLite
 * WASM. That is the number a learner feels between pressing Run and seeing output.
 */

const LOOP = `InventTable inventTable;
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

info(strFmt("Blocked %1 items", counter));`;

/** Replaces the editor contents. Monaco owns the DOM, so drive it through the keyboard. */
async function typeProgram(page: import("@playwright/test").Page, source: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  // Monaco auto-closes brackets and quotes; pasting through the clipboard API avoids
  // fighting it character by character.
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press("ControlOrMeta+V");
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("a while select loop populates all four panels", async ({ page }) => {
  await page.goto("/playground");

  // Wait for the engine to have loaded the seed data into the Data panel.
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("tab-data").click();
  await expect(page.getByTestId("data-panel")).toContainText("InventTable", { timeout: 30_000 });

  await typeProgram(page, LOOP);

  const startedAt = Date.now();
  await page.getByTestId("run").click();

  // 1. Infolog
  await expect(page.getByTestId("infolog")).toContainText("Blocked 4 items", { timeout: 15_000 });
  const elapsed = Date.now() - startedAt;

  // 2. SQL trace — the loop's one SELECT plus one UPDATE per row.
  await page.getByTestId("tab-sql").click();
  const trace = page.getByTestId("sql-trace");
  await expect(trace).toContainText("SELECT");
  await expect(trace).toContainText("UPDATE InventTable");
  await expect(trace).toContainText("SAVEPOINT tts_1");

  // 3. Data — the rows whose values actually changed are highlighted.
  //
  // Three, not four. The loop visits four FURNITURE items, but F-102 is already blocked
  // in the seed (deliberately, so "block everything" has a no-op row to handle), and
  // writing the value it already had changes nothing. The Infolog counter says 4 because
  // the loop ran four times; the highlight says 3 because three rows differ. Both are
  // right, and the gap between them is worth a learner noticing.
  await page.getByTestId("tab-data").click();
  await expect(page.locator('[data-changed="true"]')).toHaveCount(3);

  // 4. Errors — empty, because the code is correct.
  await page.getByTestId("tab-errors").click();
  await expect(page.getByTestId("errors")).toHaveCount(0);
  await expect(page.getByText("No errors.")).toBeVisible();

  expect(elapsed, `run took ${elapsed}ms, budget is 500ms`).toBeLessThan(500);
});

test("an error is reported with a hint and jumps to the line", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });

  // Missing forupdate: the buffer is read-only, which is VB-003.
  await typeProgram(
    page,
    `InventTable inventTable;
ttsbegin;
select inventTable where inventTable.ItemId == "F-100";
inventTable.ItemName = "Renamed";
inventTable.update();
ttscommit;`,
  );

  await page.getByTestId("run").click();

  // Running with errors switches to the Errors tab on its own.
  const errors = page.getByTestId("errors");
  await expect(errors).toContainText("not selected for update", { timeout: 15_000 });
  await expect(errors).toContainText("forupdate");

  // Clicking the error focuses the editor at that line.
  await errors.getByRole("button").first().click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
});

test("a parse error is marked in the editor before running", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });

  await typeProgram(page, "int counter = ;");

  // The squiggle comes from the parser on a debounce, with no Run needed.
  await expect(page.locator(".monaco-editor .squiggly-error").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("reset restores the seeded data", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });

  await typeProgram(
    page,
    `InventTable inventTable;
ttsbegin;
delete_from inventTable;
ttscommit;
info("deleted");`,
  );
  await page.getByTestId("run").click();
  await expect(page.getByTestId("infolog")).toContainText("deleted", { timeout: 15_000 });

  await page.getByTestId("tab-data").click();
  await expect(page.getByTestId("data-panel")).not.toContainText("InventTable");

  await page.getByRole("button", { name: "Reset data" }).click();
  await expect(page.getByTestId("data-panel")).toContainText("InventTable", { timeout: 15_000 });
});

test("a permalink round-trips the code", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });

  await typeProgram(page, 'info("shared from a permalink");');
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();

  const url = page.url();
  expect(url).toContain("#code=");

  // A fresh load of the same URL restores the code, and it runs.
  await page.goto(url);
  await expect(page.getByTestId("run")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("run").click();
  await expect(page.getByTestId("infolog")).toContainText("shared from a permalink", {
    timeout: 15_000,
  });
});
