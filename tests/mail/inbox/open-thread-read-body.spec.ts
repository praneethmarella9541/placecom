// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { openPrimaryThread } from "../../helpers/inbox-real-data";

test.describe("Inbox — Read Thread, Attachments & Calendar Invites", () => {
  test("Open thread and read message body", async ({ staffInboxPage: page }) => {
    await openPrimaryThread(page);
    await expect(page.getByTestId("inbox-close-thread-btn")).toBeVisible();
  });
});
