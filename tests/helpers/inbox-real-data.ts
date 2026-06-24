import { expect, type Page, type Response } from "@playwright/test";

/** Real recipient addresses approved for outbound E2E sends. */
export const E2E_RECIPIENT_1 = "saibharath9999@gmail.com";
export const E2E_RECIPIENT_2 = "venkatapraneeth5@gmail.com";

export const PRIMARY_CATEGORY_LABEL = "CATEGORY_PERSONAL";

export type InboxThreadSummary = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
};

type ThreadListResponse = {
  threads?: Array<{
    id: string;
    subject?: string;
    from?: string;
    snippet?: string;
  }>;
};

type ThreadDetailResponse = {
  messages?: Array<{
    id: string;
    from: string;
    to: string;
    cc?: string;
    subject?: string;
  }>;
};

function isPrimaryInboxThreadsResponse(res: Response) {
  if (!res.url().includes("/api/gmail/threads") || res.request().method() !== "GET") {
    return false;
  }
  if (!res.ok()) return false;
  const url = new URL(res.url());
  if (url.pathname !== "/api/gmail/threads") return false;
  const labelId = url.searchParams.get("labelId");
  const folder = url.searchParams.get("folder") ?? "inbox";
  return labelId === PRIMARY_CATEGORY_LABEL || (folder === "inbox" && !labelId);
}

export function threadTestId(threadId: string) {
  return `inbox-thread-${threadId}`;
}

export async function waitForInboxThreadList(
  page: Page,
  minCount = 1,
  timeout = 30_000,
) {
  await expect
    .poll(
      async () => page.locator('[data-testid^="inbox-thread-"]').count(),
      { timeout },
    )
    .toBeGreaterThanOrEqual(minCount);
}

export async function getPrimaryThreadsFromDom(
  page: Page,
  count = 3,
): Promise<InboxThreadSummary[]> {
  await waitForInboxThreadList(page, Math.min(count, 1));

  const rows = page.locator('[data-testid^="inbox-thread-"]');
  const available = await rows.count();
  const take = Math.min(count, available);

  const summaries: InboxThreadSummary[] = [];
  for (let i = 0; i < take; i++) {
    const row = rows.nth(i);
    const testId = (await row.getAttribute("data-testid")) ?? "";
    const id = testId.replace("inbox-thread-", "");
    const text = (await row.innerText()).trim();
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const subjectLine = lines[1] ?? lines[0] ?? "";
    const subject = subjectLine.split(" — ")[0]?.trim() || "(no subject)";
    summaries.push({
      id,
      subject,
      from: lines[0] ?? "",
      snippet: subjectLine.includes(" — ")
        ? subjectLine.split(" — ").slice(1).join(" — ")
        : "",
    });
  }

  return summaries;
}

export async function waitForPrimaryThreads(
  page: Page,
  count = 3,
): Promise<InboxThreadSummary[]> {
  const listResponse = page.waitForResponse(isPrimaryInboxThreadsResponse, {
    timeout: 30_000,
  });

  await expect(page.getByTestId("inbox-compose-btn")).toBeVisible();
  await page.getByTestId("inbox-refresh-btn").click();

  const response = await listResponse;
  const data = (await response.json()) as ThreadListResponse;
  const apiThreads = (data.threads ?? []).slice(0, count);

  if (apiThreads.length === 0) {
    throw new Error(
      "Primary inbox returned no threads. Ensure the staff account has mail in Primary.",
    );
  }

  for (const thread of apiThreads) {
    await expect(page.getByTestId(threadTestId(thread.id))).toBeVisible({
      timeout: 20_000,
    });
  }

  return apiThreads.map((thread) => ({
    id: thread.id,
    subject: thread.subject?.trim() || "(no subject)",
    from: thread.from ?? "",
    snippet: thread.snippet ?? "",
  }));
}

export async function getFirstPrimaryThread(page: Page) {
  const threads = await getPrimaryThreadsFromDom(page, 1);
  if (!threads[0]) {
    const refreshed = await waitForPrimaryThreads(page, 1);
    return refreshed[0];
  }
  return threads[0];
}

export async function openPrimaryThread(page: Page, threadId?: string) {
  const thread = threadId
    ? { id: threadId, subject: "", from: "", snippet: "" }
    : await getFirstPrimaryThread(page);

  const detailResponse = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/gmail/threads/${encodeURIComponent(thread.id)}`) &&
      res.request().method() === "GET" &&
      res.ok(),
    { timeout: 20_000 },
  );

  await page.getByTestId(threadTestId(thread.id)).click();
  const detail = (await (await detailResponse).json()) as ThreadDetailResponse;
  await expect(page.getByTestId("inbox-close-thread-btn")).toBeVisible({
    timeout: 15_000,
  });

  const subject =
    thread.subject ||
    detail.messages?.[detail.messages.length - 1]?.subject ||
    "(no subject)";

  return {
    ...thread,
    subject,
    messages: detail.messages ?? [],
  };
}

export async function waitForSendRequest(page: Page) {
  const response = await page.waitForResponse(
    (res) =>
      res.url().includes("/api/gmail/send") &&
      res.request().method() === "POST",
    { timeout: 30_000 },
  );
  expect(response.ok()).toBeTruthy();
  return response.request().postDataJSON() as Record<string, unknown>;
}
