// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, STAFF_PASSWORD } from "../../fixtures/auth";
import { E2E_RECIPIENT_2 } from "../../helpers/inbox-real-data";

test.describe("Inbox — Compose & Send", () => {
  test("Empty rich-text body blocked on send", async ({ staffInboxPage: page }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD is required");

    await page.getByTestId("inbox-compose-btn").click();
    await page.getByRole("textbox", { name: "Recipients" }).fill(E2E_RECIPIENT_2);
    await page.getByPlaceholder("Subject").fill("Subject only");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("New Message")).toHaveCount(0, { timeout: 5_000 });
    await expect(
      page.getByText("Please specify at least one recipient."),
    ).toHaveCount(0);
  });
});
