import { test as base, expect, type Page } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import {
  setupGmailMocks,
  type GmailMockOptions,
} from "../helpers/gmail-mocks";
import {
  clearMailSessionCaches,
  installMailCacheReset,
  refreshInboxList,
  waitForInboxThread,
} from "../helpers/inbox-test-helpers";
import { waitForInboxThreadList } from "../helpers/inbox-real-data";

dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const STAFF_EMAIL =
  process.env.PLAYWRIGHT_STAFF_EMAIL ?? "baburajendra863@gmail.com";
export const STAFF_PASSWORD = process.env.PLAYWRIGHT_STAFF_PASSWORD ?? "";
export const RESTRICTED_EMAIL =
  process.env.PLAYWRIGHT_RESTRICTED_EMAIL ?? "no_mail@gmail.com";
export const RESTRICTED_PASSWORD =
  process.env.PLAYWRIGHT_RESTRICTED_PASSWORD ?? "";

export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(password);
  await page.getByTestId("auth-signin-btn").click();
}

export async function waitForMailboxNav(page: Page) {
  await expect(page.getByTestId("nav-inbox")).toBeVisible({ timeout: 30_000 });
}

export async function loginAsStaff(page: Page) {
  if (!STAFF_PASSWORD) {
    throw new Error(
      "PLAYWRIGHT_STAFF_PASSWORD is not set. Copy .env.test.example to .env.test.",
    );
  }
  await signInWithPassword(page, STAFF_EMAIL, STAFF_PASSWORD);
  await page.waitForURL("**/inbox", { timeout: 30_000 });
  await waitForMailboxNav(page);
}

export async function waitForRestrictedNav(page: Page) {
  await expect(page.getByTestId("nav-inbox")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("nav-dashboard")).toBeVisible({
    timeout: 30_000,
  });
}

export async function loginAsRestricted(page: Page) {
  if (!RESTRICTED_PASSWORD) {
    throw new Error(
      "PLAYWRIGHT_RESTRICTED_PASSWORD is not set. Copy .env.test.example to .env.test.",
    );
  }
  await installMailCacheReset(page);
  await signInWithPassword(page, RESTRICTED_EMAIL, RESTRICTED_PASSWORD);
  await page.waitForURL((url) => !url.pathname.endsWith("/"), {
    timeout: 30_000,
  });
  await waitForRestrictedNav(page);
}

/** Sign in as staff and load the real Primary inbox (no Gmail mocks). */
export async function loginAsStaffWithInbox(page: Page) {
  await installMailCacheReset(page);
  await loginAsStaff(page);
  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-compose-btn")).toBeVisible();
  await refreshInboxList(page);
  await waitForInboxThreadList(page, 1);
}

/** Gmail mocks — only for error-path tests (e.g. expired token). */
export async function loginAsStaffWithInboxMocks(
  page: Page,
  options: GmailMockOptions = {},
) {
  await installMailCacheReset(page);
  await setupGmailMocks(page, options);
  await loginAsStaff(page);
  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-compose-btn")).toBeVisible();
  if (!options.threadsStatus || options.threadsStatus === 200) {
    await refreshInboxList(page);
  }
}

export {
  waitForInboxThread,
  refreshInboxList,
  installMailCacheReset,
  clearMailSessionCaches,
};

export type MailTestFixtures = {
  staffPage: Page;
  staffInboxPage: Page;
  restrictedPage: Page;
};

export const test = base.extend<MailTestFixtures>({
  staffPage: async ({ page }, use) => {
    await loginAsStaff(page);
    await use(page);
  },
  staffInboxPage: async ({ page }, use) => {
    await loginAsStaffWithInbox(page);
    await use(page);
  },
  restrictedPage: async ({ page }, use) => {
    await loginAsRestricted(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
