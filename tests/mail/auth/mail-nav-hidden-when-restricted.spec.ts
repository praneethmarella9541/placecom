// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, loginAsRestricted } from "../../fixtures/auth";

test.describe("Authentication — Mail Landing & Nav Readiness", () => {
  test("Mail nav item hidden when inbox feature restricted", async ({ page }) => {
    await loginAsRestricted(page);

    await expect(page.getByTestId("nav-inbox")).toHaveCount(0);
    await page.goto("/inbox");
    await expect(page).not.toHaveURL(/\/inbox$/);
  });
});
