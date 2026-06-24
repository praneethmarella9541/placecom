// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, loginAsStaffWithInbox } from "./tests/fixtures/auth";
import { getFirstPrimaryThread } from "./tests/helpers/inbox-real-data";

test.describe("Seed", () => {
  test("seed — staff login lands on inbox", async ({ page }) => {
    await loginAsStaffWithInbox(page);
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByTestId("nav-inbox")).toBeVisible();
    const firstThread = await getFirstPrimaryThread(page);
    await expect(
      page.getByTestId(`inbox-thread-${firstThread.id}`),
    ).toBeVisible();
  });
});
