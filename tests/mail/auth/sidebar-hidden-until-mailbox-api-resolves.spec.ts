// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import {
  test,
  expect,
  STAFF_PASSWORD,
  loginAsStaff,
  clearMailSessionCaches,
} from "../../fixtures/auth";

test.describe("Authentication — Mail Landing & Nav Readiness", () => {
  test("Sidebar hidden until mailbox API resolves", async ({ page }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD is required");

    // Establish session first (mailbox must resolve for initial sign-in redirect).
    await loginAsStaff(page);
    await clearMailSessionCaches(page);

    let releaseMailbox: (() => void) | undefined;
    const mailboxGate = new Promise<void>((resolve) => {
      releaseMailbox = resolve;
    });

    await page.route("**/api/me/mailbox", async (route) => {
      await mailboxGate;
      await route.continue();
    });

    // Reload inbox — shell mounts but nav waits on mailbox.
    await page.goto("/inbox");

    await expect(page.getByTestId("nav-inbox")).toHaveCount(0, {
      timeout: 3_000,
    });

    releaseMailbox?.();

    await expect(page.getByTestId("nav-inbox")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  });
});
