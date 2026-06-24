// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import type { Response } from "@playwright/test";
import {
  getFirstPrimaryThread,
  openPrimaryThread,
} from "../../helpers/inbox-real-data";

test.describe("Inbox — Labels", () => {
  test("Apply and remove label on open thread", async ({ staffInboxPage: page }) => {
    const firstThread = await getFirstPrimaryThread(page);
    await openPrimaryThread(page, firstThread.id);

    await page.getByRole("button", { name: "Labels" }).click();

    const userLabelRow = page
      .locator('label:has(input[type="checkbox"])')
      .first();
    await expect(userLabelRow).toBeVisible({ timeout: 10_000 });

    const checkbox = userLabelRow.locator('input[type="checkbox"]');
    const labelName = ((await userLabelRow.innerText()) || "").trim();
    test.skip(!labelName, "No user labels available on this mailbox");

    const labelsResponse = page.waitForResponse((res: Response) =>
      res.url().includes(`/api/gmail/threads/${encodeURIComponent(firstThread.id)}/labels`),
    );

    const wasChecked = await checkbox.isChecked();
    if (!wasChecked) {
      await checkbox.check();
      await labelsResponse;
    }

    await checkbox.uncheck();
  });
});
