// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { getFirstPrimaryThread } from "../../helpers/inbox-real-data";

test.describe("Access Control — Mail Feature Gating", () => {
  test("Staff user can open inbox", async ({ staffInboxPage: page }) => {
    await expect(page.getByTestId("inbox-compose-btn")).toBeVisible();
    const firstThread = await getFirstPrimaryThread(page);
    await expect(
      page.getByTestId(`inbox-thread-${firstThread.id}`),
    ).toBeVisible();
  });
});
