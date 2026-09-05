import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";
import { fetchGmail, GMAIL_COST } from "@/lib/gmail-quota";

type LabelCallOpts = { mailboxKey?: string };

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * A label as returned by Gmail. We keep the raw Gmail shape so callers can
 * map the user-visible name (`name`) and the immutable id (`id`) without
 * us picking a canonical naming.
 */
export type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  /** True iff this label is one we want to surface (user labels + a small
   *  whitelist of system labels like IMPORTANT/STARRED/CATEGORY_*). */
  surfaced: boolean;
  /** Convenience flags for the UI to pick icons/colors. */
  isSystem: boolean;
  isCategory: boolean;
  /** Display color from Gmail if set (only on user labels). */
  color?: { textColor?: string; backgroundColor?: string };
};

// System labels that we want to show in the UI as label chips. Everything
// else (INBOX, SENT, DRAFT, TRASH, SPAM, UNREAD) is excluded because it's
// folder state, not a user-meaningful tag.
const SURFACED_SYSTEM_LABELS = new Set([
  "IMPORTANT",
  "STARRED",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

function shouldSurface(label: { id: string; type?: string }): boolean {
  if (label.type === "user") return true;
  return SURFACED_SYSTEM_LABELS.has(label.id);
}

/** Friendly display name for system labels — Gmail returns them in shouty CAPS. */
export function prettyLabelName(label: GmailLabel): string {
  if (label.type === "user") return label.name;
  // CATEGORY_PERSONAL → Personal, IMPORTANT → Important
  const stripped = label.id.replace(/^CATEGORY_/, "");
  return stripped.charAt(0) + stripped.slice(1).toLowerCase();
}

export async function listLabels(
  accessToken: string,
  opts?: LabelCallOpts
): Promise<GmailLabel[]> {
  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/labels`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.labelsList }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (labels list)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail labels list ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    labels?: {
      id: string;
      name: string;
      type?: "system" | "user";
      color?: { textColor?: string; backgroundColor?: string };
    }[];
  };
  const all = body.labels ?? [];
  return all.map((l) => {
    const type = l.type === "user" ? "user" : "system";
    return {
      id: l.id,
      name: l.name,
      type,
      surfaced: shouldSurface(l),
      isSystem: type === "system",
      isCategory: l.id.startsWith("CATEGORY_"),
      color: l.color,
    };
  });
}

export async function createLabel(
  accessToken: string,
  input: { name: string; color?: { textColor: string; backgroundColor: string } },
  opts?: LabelCallOpts
): Promise<GmailLabel> {
  const payload: Record<string, unknown> = {
    name: input.name,
    // Show in label list + message list (Gmail defaults)
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
  };
  if (input.color) payload.color = input.color;

  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/labels`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.labelsList }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (create label)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail create label ${res.status}: ${text}`);
  }
  const created = (await res.json()) as {
    id: string;
    name: string;
    type?: "system" | "user";
    color?: { textColor?: string; backgroundColor?: string };
  };
  // Gmail's users.labels.create response omits the `type` field — but a label
  // created via this endpoint is by definition a user label (system labels
  // can't be created through the API). Default to "user" so the client
  // doesn't misclassify it as system and filter it out of the sidebar.
  const type: "system" | "user" = created.type ?? "user";
  return {
    id: created.id,
    name: created.name,
    type,
    surfaced: type === "user" || SURFACED_SYSTEM_LABELS.has(created.id),
    isSystem: type === "system",
    isCategory: created.id.startsWith("CATEGORY_"),
    color: created.color,
  };
}

export async function updateLabel(
  accessToken: string,
  labelId: string,
  input: { name: string },
  opts?: LabelCallOpts
): Promise<GmailLabel> {
  const name = input.name.trim();
  if (!name) throw new Error("Label name is required");

  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/labels/${encodeURIComponent(labelId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.labelsList }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (update label)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail update label ${res.status}: ${text}`);
  }
  const updated = (await res.json()) as {
    id: string;
    name: string;
    type?: "system" | "user";
    color?: { textColor?: string; backgroundColor?: string };
  };
  const type: "system" | "user" = updated.type === "user" ? "user" : "system";
  return {
    id: updated.id,
    name: updated.name,
    type,
    surfaced: type === "user" || SURFACED_SYSTEM_LABELS.has(updated.id),
    isSystem: type === "system",
    isCategory: updated.id.startsWith("CATEGORY_"),
    color: updated.color,
  };
}

/** Deletes a user label from Gmail; messages keep their other labels. */
export async function deleteLabel(
  accessToken: string,
  labelId: string,
  opts?: LabelCallOpts
): Promise<void> {
  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.labelsList }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (delete label)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail delete label ${res.status}: ${text}`);
  }
}

/** Union of label ids across all messages in a thread (folder labels excluded). */
const FOLDER_LABELS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "UNREAD",
  "CHAT",
]);

export async function getThreadLabels(
  accessToken: string,
  threadId: string,
  opts?: LabelCallOpts
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=minimal`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.threadsGet }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (thread labels)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail thread labels ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { messages?: { labelIds?: string[] }[] };
  const all = new Set<string>();
  for (const m of body.messages ?? []) {
    for (const id of m.labelIds ?? []) {
      if (!FOLDER_LABELS.has(id)) all.add(id);
    }
  }
  return Array.from(all);
}

/**
 * Add and/or remove labels on a thread (applies to every message in the
 * thread, matching Gmail's web behavior).
 */
export async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  changes: { add?: string[]; remove?: string[] },
  opts?: LabelCallOpts
): Promise<{ labelIds: string[] }> {
  const body: Record<string, unknown> = {};
  if (changes.add && changes.add.length > 0) body.addLabelIds = changes.add;
  if (changes.remove && changes.remove.length > 0) body.removeLabelIds = changes.remove;
  if (Object.keys(body).length === 0) {
    return { labelIds: [] };
  }
  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.threadsModify }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (modify thread labels)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail modify thread labels ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { messages?: { labelIds?: string[] }[] };
  const allLabels = new Set<string>();
  for (const m of data.messages ?? []) {
    for (const id of m.labelIds ?? []) allLabels.add(id);
  }
  return { labelIds: Array.from(allLabels) };
}
