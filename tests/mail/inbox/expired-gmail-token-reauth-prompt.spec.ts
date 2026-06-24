// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { loginAsStaffWithInboxMocks, STAFF_PASSWORD } from "../../fixtures/auth";

test.describe("Inbox — Edge Cases & Error Handling", () => {
  test("Expired Gmail token shows re-auth prompt", async ({ page }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD is required");

    await loginAsStaffWithInboxMocks(page, {
      threadsStatus: 401,
      threadsError: "Google token expired. Sign in again.",
    });

    await expect(
      page.getByText("Google token expired. Sign in again."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="inbox-thread-"]')).toHaveCount(0);
  });
});
