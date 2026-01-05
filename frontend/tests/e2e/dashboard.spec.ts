import { test, expect } from "@playwright/test";

test("dashboard loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Portfolio Command Deck" })).toBeVisible();
  await expect(page.getByText("Portfolio Value")).toBeVisible();
});
