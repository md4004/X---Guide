import { expect, test } from "@playwright/test";

test("the app builds and serves the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Learn X++");

  // Both ways in work. Nothing about build phases appears — that is for PLAN.md, not for
  // someone who came here to learn X++.
  await expect(page.getByRole("link", { name: "Start learning" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the sandbox" })).toBeVisible();
  await expect(page.getByText(/Phase \d/)).toHaveCount(0);
});
