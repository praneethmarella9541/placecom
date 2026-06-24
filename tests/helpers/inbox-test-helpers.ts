import { expect, type Page } from "@playwright/test";

/** Clear client-side mail caches before each document loads. */
export async function installMailCacheReset(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.removeItem("placecom:mail-list-views");
    sessionStorage.removeItem("placecom:mail-thread-bodies");
    sessionStorage.removeItem("placecom-inbox-unread");
    localStorage.removeItem("nucleus:me-mailbox:v1");
  });
}

/** Best-effort clear when a document is already open. */
export async function clearMailSessionCaches(page: Page) {
  await page
    .evaluate(() => {
      sessionStorage.removeItem("placecom:mail-list-views");
      sessionStorage.removeItem("placecom:mail-thread-bodies");
      sessionStorage.removeItem("placecom-inbox-unread");
      localStorage.removeItem("nucleus:me-mailbox:v1");
    })
    .catch(() => {
      /* no document yet — addInitScript handles the next navigation */
    });
}

export async function waitForInboxThread(page: Page, threadId?: string) {
  if (threadId) {
    await expect(page.getByTestId(`inbox-thread-${threadId}`)).toBeVisible({
      timeout: 20_000,
    });
    return;
  }

  await expect(page.locator('[data-testid^="inbox-thread-"]').first()).toBeVisible({
    timeout: 20_000,
  });
}

export async function refreshInboxList(page: Page) {
  await page.getByTestId("inbox-refresh-btn").click();
  await waitForInboxThread(page);
}
