import "server-only";

import type { AuthedRequest } from "@/lib/api-auth";
import { resolveMailboxGoogleAccessToken } from "@/lib/mailbox-google-access";
import { normalizeRestrictedFeatures, type FeatureKey } from "@/lib/feature-access";
import { sendExpoPush } from "@/lib/expo-push";
import { createServiceSupabase } from "@/lib/supabase-service";
import { peerKeysForQuery } from "@/lib/whatsapp-peer";

function formatPeer(peer: string): string {
  if (peer.startsWith("+91") && peer.length === 13) {
    return `+91 ${peer.slice(3, 8)} ${peer.slice(8)}`;
  }
  return peer;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function userHasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return true;
  }
  const { data } = await svc.from("profiles").select("role, restricted_features").eq("id", userId).maybeSingle();
  if (!data) return true;
  const role = data.role as string;
  if (role === "admin" || role === "staff") return true;
  const restricted = normalizeRestrictedFeatures(data.restricted_features);
  return !restricted.includes(feature);
}

async function tokensForUser(userId: string): Promise<string[]> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return [];
  }
  const { data, error } = await svc
    .from("push_device_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);
  if (error) {
    if (/push_device_tokens/i.test(error.message)) return [];
    console.warn("[push] load tokens:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.expo_push_token as string).filter(Boolean);
}

async function removeInvalidTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  try {
    const svc = createServiceSupabase();
    await svc.from("push_device_tokens").delete().in("expo_push_token", tokens);
  } catch {
    /* ignore */
  }
}

async function sendToUser(
  userId: string,
  feature: FeatureKey,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<void> {
  if (!(await userHasFeature(userId, feature))) return;
  const tokens = await tokensForUser(userId);
  if (!tokens.length) return;
  const invalid = await sendExpoPush(tokens, payload);
  if (invalid.length) await removeInvalidTokens(invalid);
}

async function waContactLabel(ownerUserId: string, peerE164: string): Promise<string> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return formatPeer(peerE164);
  }
  const keys = peerKeysForQuery(peerE164);
  if (!keys.length) return formatPeer(peerE164);
  const { data } = await svc
    .from("wa_contacts")
    .select("name")
    .eq("user_id", ownerUserId)
    .in("peer_e164", keys)
    .limit(1);
  const name = (data?.[0]?.name as string | undefined)?.trim();
  return name || formatPeer(peerE164);
}

/** Notify the line owner when a new inbound WhatsApp message is stored. */
export async function notifyWhatsAppInbound(params: {
  ownerUserId: string | null;
  peerE164: string;
  bodyPreview: string | null;
}): Promise<void> {
  const { ownerUserId, peerE164, bodyPreview } = params;
  if (!ownerUserId) return;

  const label = await waContactLabel(ownerUserId, peerE164);
  const preview = bodyPreview?.trim()
    ? truncate(bodyPreview, 120)
    : "New message";

  await sendToUser(ownerUserId, "whatsapp", {
    title: label,
    body: preview,
    data: {
      type: "whatsapp",
      peer: peerE164,
    },
  });
}

async function gmailProfileHistoryId(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { historyId?: string };
  return data.historyId?.trim() || null;
}

async function gmailHasInboxChanges(
  accessToken: string,
  since: string
): Promise<{ hasChanges: boolean; latestHistoryId?: string; expired?: boolean }> {
  const params = new URLSearchParams({
    startHistoryId: since,
    labelId: "INBOX",
    maxResults: "10",
    historyTypes: "labelAdded",
  });
  params.append("historyTypes", "labelRemoved");
  params.append("historyTypes", "messageAdded");
  params.append("historyTypes", "messageDeleted");

  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}/history?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { hasChanges: false };
  }

  if (res.status === 404) return { hasChanges: true, expired: true };
  if (!res.ok) return { hasChanges: false };

  const data = (await res.json()) as { history?: unknown[]; historyId?: string };
  const hasChanges = Array.isArray(data.history) && data.history.length > 0;
  return { hasChanges, latestHistoryId: data.historyId };
}

function authedForUser(userId: string): AuthedRequest {
  const supabase = createServiceSupabase();
  return {
    user: { id: userId },
    supabase,
    isBearer: true,
  };
}

/** Users to notify for a mailbox: admin owner + linked staff with push tokens. */
async function mailboxNotifyUserIds(mailboxOwnerId: string): Promise<string[]> {
  const svc = createServiceSupabase();
  const { data: tokenRows } = await svc.from("push_device_tokens").select("user_id");
  const userIds = new Set((tokenRows ?? []).map((r) => r.user_id as string));

  const { data: profiles } = await svc
    .from("profiles")
    .select("id, role, mailbox_owner_id")
    .or(`id.eq.${mailboxOwnerId},mailbox_owner_id.eq.${mailboxOwnerId}`);

  const notify = new Set<string>();
  for (const p of profiles ?? []) {
    const id = p.id as string;
    if (!userIds.has(id)) continue;
    const role = p.role as string;
    if (id === mailboxOwnerId || (role !== "admin" && p.mailbox_owner_id === mailboxOwnerId)) {
      notify.add(id);
    }
  }
  return Array.from(notify);
}

export async function ensureGmailPushCursor(userId: string): Promise<void> {
  const auth = await resolveMailboxGoogleAccessToken(authedForUser(userId));
  if (!auth.ok) return;

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return;
  }

  const { data: existing } = await svc
    .from("gmail_push_state")
    .select("mailbox_owner_id")
    .eq("mailbox_owner_id", auth.mailboxOwnerId)
    .maybeSingle();
  if (existing) return;

  const historyId = await gmailProfileHistoryId(auth.accessToken);
  if (!historyId) return;

  await svc.from("gmail_push_state").upsert({
    mailbox_owner_id: auth.mailboxOwnerId,
    last_history_id: historyId,
    updated_at: new Date().toISOString(),
  });
}

/** Cron: check Gmail history per mailbox and push when INBOX has new activity. */
export async function runGmailPushCron(): Promise<{ mailboxes: number; notified: number }> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return { mailboxes: 0, notified: 0 };
  }

  const { data: tokenRows, error } = await svc.from("push_device_tokens").select("user_id");
  if (error?.message?.includes("push_device_tokens")) {
    return { mailboxes: 0, notified: 0 };
  }

  const uniqueUsers = Array.from(new Set((tokenRows ?? []).map((r) => r.user_id as string)));
  const mailboxToUsers = new Map<string, Set<string>>();

  for (const userId of uniqueUsers) {
    const auth = await resolveMailboxGoogleAccessToken(authedForUser(userId));
    if (!auth.ok) continue;
    const set = mailboxToUsers.get(auth.mailboxOwnerId) ?? new Set();
    set.add(userId);
    mailboxToUsers.set(auth.mailboxOwnerId, set);
  }

  let notified = 0;

  for (const [mailboxOwnerId] of Array.from(mailboxToUsers)) {
    const auth = await resolveMailboxGoogleAccessToken(authedForUser(mailboxOwnerId));
    if (!auth.ok) continue;

    const { data: state } = await svc
      .from("gmail_push_state")
      .select("last_history_id")
      .eq("mailbox_owner_id", mailboxOwnerId)
      .maybeSingle();

    let since = (state?.last_history_id as string | undefined)?.trim();
    if (!since) {
      since = (await gmailProfileHistoryId(auth.accessToken)) ?? undefined;
      if (!since) continue;
      await svc.from("gmail_push_state").upsert({
        mailbox_owner_id: mailboxOwnerId,
        last_history_id: since,
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    const result = await gmailHasInboxChanges(auth.accessToken, since);
    const latest =
      result.latestHistoryId ?? (await gmailProfileHistoryId(auth.accessToken)) ?? since;

    if (result.hasChanges) {
      const targets = await mailboxNotifyUserIds(mailboxOwnerId);
      for (const userId of targets) {
        await sendToUser(userId, "inbox", {
          title: "New mail",
          body: "You have new messages in your inbox",
          data: { type: "inbox" },
        });
      }
      notified += targets.length;
    }

    await svc.from("gmail_push_state").upsert({
      mailbox_owner_id: mailboxOwnerId,
      last_history_id: latest,
      updated_at: new Date().toISOString(),
    });
  }

  return { mailboxes: mailboxToUsers.size, notified };
}
