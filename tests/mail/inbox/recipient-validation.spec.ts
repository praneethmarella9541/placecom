// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import {
  test,
  expect,
  waitForInboxThread,
  clearMailSessionCaches,
} from "../../fixtures/auth";

test.describe("Inbox — Compose & Send", () => {
  test("Recipient validation — empty To and malformed address", async ({
    staffInboxPage: page,
  }) => {
    const composeSend = page
      .locator("[data-compose-dialog]")
      .getByRole("button", { name: "Send", exact: true });

    await page.getByTestId("inbox-compose-btn").click();

    // Empty To — Send stays disabled (client-side guard).
    await expect(composeSend).toBeDisabled();

    await page.getByPlaceholder("Recipients").fill("not-an-email");
    await page.getByRole("textbox", { name: "Compose email" }).fill("Body.");
    await composeSend.click();

    await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
    await expect(page.getByText(/not recognized/i)).toBeVisible();
  });
});
