// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import type { Route } from "@playwright/test";
import { E2E_RECIPIENT_1 } from "../../helpers/inbox-real-data";

test.describe("Inbox — Draft Autosave & Resume", () => {
  test("Draft autosaves while composing", async ({ staffInboxPage: page }) => {
    await page.getByTestId("inbox-compose-btn").click();
    await page.getByPlaceholder("Recipients").fill(E2E_RECIPIENT_1);

    const draftResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/gmail/drafts") &&
        (res.request().method() === "POST" || res.request().method() === "PUT") &&
        res.ok(),
      { timeout: 15_000 },
    );

    await page
      .getByRole("textbox", { name: "Compose email" })
      .fill("Partial draft body");

    await draftResponse;
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 10_000 });
  });
});
