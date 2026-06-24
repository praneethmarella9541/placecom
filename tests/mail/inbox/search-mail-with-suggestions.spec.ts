// spec: specs/mail-functionality.md
// seed: seed.spec.ts

import { test, expect } from "../../fixtures/auth";
import { getFirstPrimaryThread } from "../../helpers/inbox-real-data";

test.describe("Inbox — Search", () => {
  test("Search mail input accepts query", async ({ staffInboxPage: page }) => {
    const searchInput = page.getByTestId("inbox-search-input");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("recruiter");
    await expect(searchInput).toHaveValue("recruiter");
  });
});

test.describe("Inbox — Search, Archive & Delete", () => {
  test("Search mail with query suggestions", async ({ staffInboxPage: page }) => {
    const firstThread = await getFirstPrimaryThread(page);
    const query =
      firstThread.subject.split(/\s+/).find((word) => word.length >= 4) ??
      firstThread.subject.slice(0, 8);

    const searchInput = page.getByTestId("inbox-search-input");
    await searchInput.click();
    await searchInput.fill(query);

    await page.waitForResponse((res) =>
      res.url().includes("/api/gmail/search/suggest"),
    );

    await searchInput.press("Enter");
    await expect(page.getByTestId(`inbox-thread-${firstThread.id}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});
