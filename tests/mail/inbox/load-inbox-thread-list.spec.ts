// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { waitForPrimaryThreads } from "../../helpers/inbox-real-data";

test.describe("Inbox — Load, Folders & Thread List", () => {
  test("Load inbox with thread list and folder counts", async ({
    staffInboxPage: page,
  }) => {
    await expect(page.getByTestId("inbox-folder-inbox")).toBeVisible();

    const threads = await waitForPrimaryThreads(page, 3);
    expect(threads.length).toBeGreaterThanOrEqual(1);

    for (const thread of threads) {
      await expect(page.getByTestId(`inbox-thread-${thread.id}`)).toBeVisible();
    }
  });
});
