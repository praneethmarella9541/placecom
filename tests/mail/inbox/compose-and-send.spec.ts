// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect, STAFF_PASSWORD } from "../../fixtures/auth";
import {
  E2E_RECIPIENT_1,
  waitForSendRequest,
} from "../../helpers/inbox-real-data";

async function openCompose(page: import("@playwright/test").Page) {
  await page.getByTestId("inbox-compose-btn").click();
  await expect(page.getByPlaceholder("Recipients")).toBeVisible();
}

test.describe("Inbox — Compose & Send", () => {
  test("Compose new email with To, subject, body, and send", async ({
    staffInboxPage: page,
  }) => {
    test.skip(!STAFF_PASSWORD, "PLAYWRIGHT_STAFF_PASSWORD is required");

    await openCompose(page);

    const sendPromise = waitForSendRequest(page);
    await page.getByPlaceholder("Recipients").fill(E2E_RECIPIENT_1);
    await page.getByPlaceholder("Subject").fill("E2E test subject");
    await page.getByRole("textbox", { name: "Compose email" }).fill(
      "Hello from Playwright E2E test.",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const sendPayload = await sendPromise;
    expect(sendPayload.to).toBe(E2E_RECIPIENT_1);
  });

  test("Send disabled until at least one recipient is entered", async ({
    staffInboxPage: page,
  }) => {
    await openCompose(page);

    await page.getByPlaceholder("Subject").fill("No recipient");
    await page.getByRole("textbox", { name: "Compose email" }).fill(
      "Body without recipient.",
    );

    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  });

  test("Invalid recipient shows error dialog on send", async ({
    staffInboxPage: page,
  }) => {
    await openCompose(page);

    await page.getByPlaceholder("Recipients").fill("not-an-email");
    await page.getByRole("textbox", { name: "Compose email" }).fill("Test body.");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
    await expect(page.getByText(/not recognized/i)).toBeVisible();
  });
});
