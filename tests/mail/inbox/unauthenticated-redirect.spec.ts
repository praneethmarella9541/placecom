// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Inbox — Edge Cases & Error Handling", () => {
  test("Unauthenticated workspace route redirects to sign-in", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByTestId("auth-signin-btn")).toBeVisible();
  });
});
