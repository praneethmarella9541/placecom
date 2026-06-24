// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, loginAsRestricted } from "../../fixtures/auth";

test.describe("Access Control — Mail Feature Gating", () => {
  test("Restricted user blocked from /inbox page", async ({ page }) => {
    await loginAsRestricted(page);
    await page.goto("/inbox");
    await expect(page).not.toHaveURL(/\/inbox$/);
  });
});
