import { expect, test } from "@playwright/test";

/**
 * Not really a test — a driver that walks the two new lessons and writes screenshots, so
 * the pages get looked at rather than only asserted on.
 */

const OUT = "C:/Users/MICHEL~1.SAL/AppData/Local/Temp/claude/c--Users-michel-saloumi-Desktop-X---Guide/1a20d4cc-197f-4d52-b365-bc25797bcac2/scratchpad/shots";

test("look at the forms and reports lessons", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/learn/xpp-fundamentals");
  await expect(page.getByRole("heading", { name: "X++ fundamentals" })).toBeVisible();
  await page.screenshot({ path: OUT + "/1-track.png" });

  await page.goto("/learn/xpp-fundamentals/09-forms");
  await page.getByTestId("editor").locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("form-view")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: OUT + "/2-form.png" });

  await page.goto("/learn/xpp-fundamentals/10-reports");
  await page.getByTestId("editor").locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("example-ran")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: OUT + "/3-reports.png" });
});
