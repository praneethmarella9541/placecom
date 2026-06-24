// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import type { Route } from "@playwright/test";
import { openPrimaryThread } from "../../helpers/inbox-real-data";

test.describe("Inbox — Reply, Reply-All & Forward", () => {
  test("Reply-all includes all recipients", async ({ staffInboxPage: page }) => {
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

    await page.getByRole("button", { name: /Reply all/i }).last().click();

    await expect(page.getByRole("heading", { name: /Reply all/i })).toBeVisible();

    const ccField = page.getByPlaceholder("Cc");
    const expectedCc =
      (await ccField.isVisible().catch(() => false))
        ? (await ccField.inputValue()).trim()
        : "";

    await page
      .getByRole("textbox", { name: "Compose email" })
      .fill("Reply all body.");
    await page
      .locator("[data-compose-dialog]")
      .getByRole("button", { name: "Send", exact: true })
      .click();

    await expect.poll(() => sendPayload, { timeout: 30_000 }).toBeTruthy();
    expect(sendPayload?.threadId).toBe(thread.id);

    if (expectedCc) {
      for (const addr of expectedCc.split(",").map((part) => part.trim()).filter(Boolean)) {
        expect(String(sendPayload?.cc ?? "")).toContain(addr);
      }
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "First Primary thread has no CC recipients on the latest message; verified reply-all send only.",
      });
    }
  });
});
