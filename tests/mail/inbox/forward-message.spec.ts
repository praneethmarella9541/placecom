// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import {
  E2E_RECIPIENT_2,
  openPrimaryThread,
  waitForSendRequest,
} from "../../helpers/inbox-real-data";

test.describe("Inbox — Reply, Reply-All & Forward", () => {
  test("Forward message with original content", async ({ staffInboxPage: page }) => {
    await openPrimaryThread(page);

    await page.getByRole("button", { name: "Forward", exact: true }).click();

    await expect(page.getByPlaceholder("Subject")).toHaveValue(/Fwd:/i);

    const sendPromise = waitForSendRequest(page);
    await page.getByPlaceholder("Recipients").fill(E2E_RECIPIENT_2);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const sendPayload = await sendPromise;
    expect(sendPayload.to).toBe(E2E_RECIPIENT_2);
    expect(String(sendPayload.htmlBody ?? "")).toContain("Forwarded message");
  });
});
