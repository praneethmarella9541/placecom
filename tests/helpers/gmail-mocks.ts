import type { Page, Route } from "@playwright/test";

export type MockThread = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  draftId?: string;
  labelIds?: string[];
  unread?: boolean;
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
  hasCalendarInvite?: boolean;
};

export type MockMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  body: string;
  bodyHtml?: string;
  attachments?: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
};

export type MockLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  surfaced?: boolean;
  isSystem?: boolean;
  isCategory?: boolean;
};

export const PRIMARY_CATEGORY_LABEL = "CATEGORY_PERSONAL";

export const SAMPLE_THREADS: MockThread[] = [
  {
    id: "thread-1",
    snippet: "Following up on campus placements",
    subject: "Placement outreach Q1",
    from: "sender@example.com",
    date: new Date().toISOString(),
    unread: true,
    labelIds: ["INBOX", "UNREAD", PRIMARY_CATEGORY_LABEL],
  },
  {
    id: "thread-2",
    snippet: "JD attached for review",
    subject: "Software engineer role",
    from: "recruiter@example.com",
    date: new Date(Date.now() - 86_400_000).toISOString(),
    unread: false,
    hasAttachments: true,
    labelIds: ["INBOX", PRIMARY_CATEGORY_LABEL],
  },
  {
    id: "thread-3",
    snippet: "Team sync tomorrow",
    subject: "Weekly placement sync",
    from: "team@example.com",
    date: new Date(Date.now() - 172_800_000).toISOString(),
    unread: true,
    labelIds: ["INBOX", "UNREAD", "Label_1", PRIMARY_CATEGORY_LABEL],
  },
];

export const SAMPLE_MESSAGES: Record<string, MockMessage[]> = {
  "thread-1": [
    {
      id: "msg-1a",
      threadId: "thread-1",
      subject: "Placement outreach Q1",
      from: "Sender <sender@example.com>",
      to: "team@example.com",
      cc: "cc@example.com",
      bcc: "",
      date: new Date().toISOString(),
      body: "Hello team,\n\nPlease review the placement plan.",
      bodyHtml:
        "<p>Hello team,</p><p>Please review the placement plan.</p>",
    },
    {
      id: "msg-1b",
      threadId: "thread-1",
      subject: "Re: Placement outreach Q1",
      from: "Team <team@example.com>",
      to: "sender@example.com",
      cc: "cc@example.com",
      bcc: "",
      date: new Date().toISOString(),
      body: "Thanks, we will review.",
      bodyHtml: "<p>Thanks, we will review.</p>",
    },
  ],
  "thread-2": [
    {
      id: "msg-2a",
      threadId: "thread-2",
      subject: "Software engineer role",
      from: "Recruiter <recruiter@example.com>",
      to: "team@example.com",
      cc: "",
      bcc: "",
      date: new Date().toISOString(),
      body: "Please find the JD attached.",
      bodyHtml: "<p>Please find the JD attached.</p>",
      attachments: [
        {
          attachmentId: "att-1",
          filename: "resume.pdf",
          mimeType: "application/pdf",
          size: 12_345,
        },
      ],
    },
  ],
};

export const SAMPLE_LABELS: MockLabel[] = [
  {
    id: "INBOX",
    name: "INBOX",
    type: "system",
    surfaced: true,
    isSystem: true,
    isCategory: false,
  },
  {
    id: "SENT",
    name: "SENT",
    type: "system",
    surfaced: true,
    isSystem: true,
    isCategory: false,
  },
  {
    id: "DRAFT",
    name: "DRAFT",
    type: "system",
    surfaced: true,
    isSystem: true,
    isCategory: false,
  },
  {
    id: "Label_1",
    name: "Recruiters",
    type: "user",
    surfaced: true,
    isSystem: false,
    isCategory: false,
  },
];

export type GmailMockOptions = {
  threads?: MockThread[];
  messages?: Record<string, MockMessage[]>;
  labels?: MockLabel[];
  folderCounts?: Record<string, { total: number; unread: number }>;
  threadsStatus?: number;
  threadsError?: string;
  onSend?: (body: unknown) => void;
  onDraftSave?: (body: unknown) => void;
  onBatchModify?: (body: unknown) => void;
  onLabelCreate?: (body: unknown) => void;
  onSearchSuggest?: (query: string) => unknown;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function setupGmailMocks(page: Page, options: GmailMockOptions = {}) {
  const context = page.context();
  const threads = options.threads ?? SAMPLE_THREADS;
  const messages = options.messages ?? SAMPLE_MESSAGES;
  const labels = options.labels ?? SAMPLE_LABELS;
  const folderCounts =
    options.folderCounts ??
    ({
      INBOX: { total: threads.length, unread: threads.filter((t) => t.unread).length },
      SENT: { total: 2, unread: 0 },
      DRAFT: { total: 0, unread: 0 },
      STARRED: { total: 0, unread: 0 },
      IMPORTANT: { total: 0, unread: 0 },
      TRASH: { total: 0, unread: 0 },
      SPAM: { total: 0, unread: 0 },
      Label_1: { total: 1, unread: 1 },
    } satisfies Record<string, { total: number; unread: number }>);

  let liveThreads = [...threads];

  await context.route("**/api/gmail/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;
    const method = route.request().method();

    if (pathname === "/api/gmail/threads" && method === "GET") {
      if (options.threadsStatus && options.threadsStatus !== 200) {
        return json(
          route,
          { error: options.threadsError ?? "Google token expired. Sign in again." },
          options.threadsStatus,
        );
      }

      const folder = searchParams.get("folder") ?? "inbox";
      const labelId = searchParams.get("labelId");
      const search = searchParams.get("search")?.trim();

      let filtered = [...liveThreads];
      if (folder === "sent") {
        filtered = filtered.filter((t) => t.labelIds?.includes("SENT"));
      } else if (folder === "drafts") {
        filtered = filtered.filter((t) => t.draftId);
      } else if (labelId) {
        filtered = filtered.filter((t) => t.labelIds?.includes(labelId));
      } else if (folder === "inbox") {
        filtered = filtered.filter(
          (t) => t.labelIds?.includes("INBOX") || !t.labelIds?.length,
        );
      }

      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.subject.toLowerCase().includes(q) ||
            t.snippet.toLowerCase().includes(q) ||
            t.from.toLowerCase().includes(q),
        );
      }

      return json(route, { folder, threads: filtered, nextPageToken: undefined });
    }

    const threadDetail = pathname.match(/^\/api\/gmail\/threads\/([^/]+)$/);
    if (threadDetail && method === "GET") {
      const threadId = decodeURIComponent(threadDetail[1]);
      const threadMessages = messages[threadId] ?? [];
      const labelIds =
        liveThreads.find((t) => t.id === threadId)?.labelIds ?? ["INBOX"];
      return json(route, { threadId, messages: threadMessages, labelIds });
    }

    if (pathname === "/api/gmail/folder-counts" && method === "GET") {
      return json(route, { counts: folderCounts });
    }

    if (pathname === "/api/gmail/labels" && method === "GET") {
      return json(route, { labels });
    }

    if (pathname === "/api/gmail/labels" && method === "POST") {
      const body = route.request().postDataJSON() as { name?: string };
      options.onLabelCreate?.(body);
      const created: MockLabel = {
        id: `Label_${Date.now()}`,
        name: body.name ?? "New label",
        type: "user",
        surfaced: true,
        isSystem: false,
        isCategory: false,
      };
      return json(route, { label: created });
    }

    const threadLabels = pathname.match(/^\/api\/gmail\/threads\/([^/]+)\/labels$/);
    if (threadLabels && method === "POST") {
      const threadId = decodeURIComponent(threadLabels[1]);
      const body = route.request().postDataJSON() as {
        add?: string[];
        remove?: string[];
      };
      options.onBatchModify?.(body);
      liveThreads = liveThreads.map((t) => {
        if (t.id !== threadId) return t;
        const next = new Set(t.labelIds ?? []);
        body.remove?.forEach((id) => next.delete(id));
        body.add?.forEach((id) => next.add(id));
        return { ...t, labelIds: Array.from(next) };
      });
      return json(route, { ok: true });
    }

    if (pathname === "/api/gmail/threads/batch-modify" && method === "POST") {
      const body = route.request().postDataJSON() as {
        threadIds?: string[];
        add?: string[];
        remove?: string[];
      };
      options.onBatchModify?.(body);
      const ids = new Set(body.threadIds ?? []);
      liveThreads = liveThreads.map((t) => {
        if (!ids.has(t.id)) return t;
        const next = new Set(t.labelIds ?? []);
        body.remove?.forEach((id) => next.delete(id));
        body.add?.forEach((id) => next.add(id));
        return { ...t, labelIds: Array.from(next) };
      });
      return json(route, { ok: true });
    }

    if (pathname === "/api/gmail/send" && method === "POST") {
      const body = route.request().postDataJSON();
      options.onSend?.(body);
      return json(route, { messageId: "msg-sent-1", threadId: "thread-sent-1" });
    }

    if (pathname === "/api/gmail/drafts" && method === "POST") {
      const body = route.request().postDataJSON();
      options.onDraftSave?.(body);
      return json(route, { draftId: "draft-1" });
    }

    if (pathname === "/api/gmail/drafts" && method === "PUT") {
      const body = route.request().postDataJSON();
      options.onDraftSave?.(body);
      return json(route, { draftId: "draft-1" });
    }

    if (pathname === "/api/gmail/search/suggest" && method === "GET") {
      const q = searchParams.get("q") ?? "";
      const payload =
        options.onSearchSuggest?.(q) ??
        ({
          contacts: [],
          threads: threads
            .filter((t) => t.subject.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
            .map((t) => ({
              threadId: t.id,
              subject: t.subject,
              from: t.from,
            })),
          completionEmail: null,
        } as const);
      return json(route, payload);
    }

    if (pathname === "/api/gmail/me" && method === "GET") {
      return json(route, { email: "team@example.com" });
    }

    if (pathname === "/api/gmail/tracking" && method === "GET") {
      return json(route, { rows: [] });
    }

    if (pathname === "/api/gmail/contacts" && method === "GET") {
      return json(route, { contacts: [] });
    }

    if (pathname === "/api/gmail/history" && method === "GET") {
      return json(route, { historyId: "1", changed: false });
    }

    return json(route, {});
  });

  return {
    setThreads(next: MockThread[]) {
      liveThreads = [...next];
    },
    getThreads() {
      return liveThreads;
    },
  };
}

export async function setupInboxMocks(page: Page, options?: GmailMockOptions) {
  return setupGmailMocks(page, options);
}
