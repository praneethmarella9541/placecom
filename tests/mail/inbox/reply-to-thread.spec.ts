// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import type { Route } from "@playwright/test";
import { openPrimaryThread } from "../../helpers/inbox-real-data";

test.describe("Inbox — Reply, Reply-All & Forward", () => {
  test("Reply to an open thread", async ({ staffInboxPage: page }) => {
    let sendPayload: Record<string, unknown> | undefined;
    let activeThreadId = "";

    await page.route("**/api/gmail/send", async (route: Route) => {
      sendPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messageId: "msg-sent", threadId: activeThreadId }),
      });
    });

    const thread = await openPrimaryThread(page);
    activeThreadId = thread.id;
    await expect(
      page.getByRole("heading", { name: thread.subject }),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .locator("[data-compose-dialog], main")
      .getByRole("button", { name: "Reply", exact: true })
      .last()
      .click();

    await expect(page.getByRole("heading", { name: "Reply" })).toBeVisible();
    await page
      .getByRole("textbox", { name: "Compose email" })
      .fill("Reply body from test.");
    await page
      .locator("[data-compose-dialog]")
      .getByRole("button", { name: "Send", exact: true })
      .click();

    await expect.poll(() => sendPayload, { timeout: 30_000 }).toBeTruthy();
    expect(sendPayload?.threadId).toBe(thread.id);
    expect(sendPayload?.inReplyToMessageId).toBeTruthy();
  });
});
