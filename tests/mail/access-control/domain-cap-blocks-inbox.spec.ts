// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { loginAsStaff, STAFF_PASSWORD } from "../../fixtures/auth";

test.describe("Access Control — Mail Feature Gating", () => {
  test.skip("Domain cap blocks inbox when not in NEXT_PUBLIC_ALLOWED_FEATURES", async ({
    page,
  }) => {
    // Requires app server started with:
    // NEXT_PUBLIC_ALLOWED_FEATURES=drive,forms,calendar (no inbox)
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD is required");

    await loginAsStaff(page);
    await page.goto("/inbox");
    await expect(page).not.toHaveURL(/\/inbox$/);
  });
});
