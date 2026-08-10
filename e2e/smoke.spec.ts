import { expect, test } from "@playwright/test";

test("the app builds and serves the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Learn X++");
  await expect(page.getByText("Phase 0")).toBeVisible();
});
