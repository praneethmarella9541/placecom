// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, loginAsStaff, signInWithPassword, STAFF_EMAIL, STAFF_PASSWORD } from "../../fixtures/auth";

test.describe("Authentication — Mail Landing & Nav Readiness", () => {
  test("Staff password sign-in redirects to inbox", async ({ page }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD not set");

    // 1. Navigate to sign-in page
    await page.goto("/");

    // 2–4. Fill credentials and sign in
    await signInWithPassword(page, STAFF_EMAIL, STAFF_PASSWORD);

    // 5. Wait for inbox URL
    await expect(page).toHaveURL(/\/inbox$/);

    // 6. Sidebar Mail nav visible after mailbox resolves
    await expect(page.getByTestId("nav-inbox")).toBeVisible();
    await expect(page.getByTestId("inbox-compose-btn")).toBeVisible();
  });

  test("Already-signed-in visitor to / redirects to inbox", async ({ page }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD not set");

    await loginAsStaff(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/inbox$/, { timeout: 15_000 });
    await expect(page.getByTestId("auth-signin-btn")).not.toBeVisible();
  });

  test("Empty email shows validation error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("auth-signin-btn").click();
    await expect(page.getByTestId("auth-staff-error")).toContainText(/email/i);
  });

  test("Empty password shows validation error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("auth-email-input").fill(STAFF_EMAIL);
    await page.getByTestId("auth-signin-btn").click();
    await expect(page.getByTestId("auth-staff-error")).toContainText(/password/i);
  });
});
