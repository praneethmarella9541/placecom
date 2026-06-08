import "server-only";

import { phoneMatches } from "@/lib/phone";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import { type FeatureKey } from "@/lib/feature-access";
import { sendExpoPush } from "@/lib/expo-push";
import { createServiceSupabase } from "@/lib/supabase-service";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";
import { peerKeysForQuery } from "@/lib/whatsapp-peer";

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatPeer(peer: string): string {
  if (peer.startsWith("+91") && peer.length === 13) {
    return `+91 ${peer.slice(3, 8)} ${peer.slice(8)}`;
  }
  return peer;
}

async function userHasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from("profiles")
      .select("role, restricted_features, group_id")
      .eq("id", userId)
      .maybeSingle();
    if (!data) return true;
    if ((data.role as string) === "admin") return true;

    let group: { restricted_features: unknown } | null = null;
    if (data.group_id) {
      const { data: g } = await svc
        .from("team_groups")
        .select("restricted_features")
        .eq("id", data.group_id as string)
        .maybeSingle();
      if (g) group = g as { restricted_features: unknown };
    }

    const restricted = mergeRestrictedFeatures(
      {
        role: data.role as string,
        restricted_features: data.restricted_features,
        group_id: data.group_id as string | null,
      },
      group
    );
    return !restricted.includes(feature);
  } catch {
    return true;
  }
}

async function tokensForUser(userId: string): Promise<string[]> {
  try {
    const svc = createServiceSupabase();
    const { data, error } = await svc
      .from("push_device_tokens")
      .select("expo_push_token")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      console.warn("[push] tokens query:", error.message);
      return [];
    }
    const token = (data?.[0]?.expo_push_token as string | undefined)?.trim();
    return token ? [token] : [];
  } catch (e) {
    console.warn("[push] tokensForUser:", e);
    return [];
  }
}

/** Line owner, staff under owner, and anyone with a push token + WhatsApp access. */
async function resolveWhatsAppPushRecipients(
  ownerUserId: string | null,
  businessE164: string
): Promise<string[]> {
  const ids = new Set<string>();
  if (ownerUserId) ids.add(ownerUserId);

  try {
    const svc = createServiceSupabase();

    if (ownerUserId) {
      const { data: staff } = await svc
        .from("profiles")
        .select("id")
        .eq("mailbox_owner_id", ownerUserId);
      for (const s of staff ?? []) ids.add(s.id as string);
    }

    const { data: tokenRows } = await svc.from("push_device_tokens").select("user_id");
    const tokenUserIds = Array.from(
      new Set((tokenRows ?? []).map((r) => r.user_id as string))
    );

    for (const uid of tokenUserIds) {
      if (!(await userHasFeature(uid, "whatsapp"))) continue;
      const { data: p } = await svc
        .from("profiles")
        .select("exotel_virtual_number, mailbox_owner_id")
        .eq("id", uid)
        .maybeSingle();
      if (!p) continue;
      const exotel = (p.exotel_virtual_number as string | null) ?? "";
      if (exotel && phoneMatches(exotel, businessE164)) {
        ids.add(uid);
        continue;
      }
      if (ownerUserId && p.mailbox_owner_id === ownerUserId) ids.add(uid);
    }

    // No owner matched in Team — still notify users who registered a device token.
    if (!ownerUserId && tokenUserIds.length) {
      for (const uid of tokenUserIds) {
        if (await userHasFeature(uid, "whatsapp")) ids.add(uid);
      }
    }
  } catch (e) {
    console.warn("[push] resolveWhatsAppPushRecipients:", e);
    if (ownerUserId) ids.add(ownerUserId);
  }

  return Array.from(ids);
}

async function waContactLabel(ownerUserId: string, peerE164: string): Promise<string> {
  try {
    const svc = createServiceSupabase();
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
  } catch {
    return formatPeer(peerE164);
  }
}

export async function notifyWhatsAppInbound(params: {
  ownerUserId: string | null;
  peerE164: string;
  bodyPreview: string | null;
  businessE164?: string;
}): Promise<void> {
  const businessE164 = params.businessE164 ?? "";
  let ownerUserId = params.ownerUserId;
  if (!ownerUserId && businessE164) {
    ownerUserId = await findUserIdForBusinessLine(businessE164);
  }

  const recipients = await resolveWhatsAppPushRecipients(ownerUserId, businessE164);
  if (!recipients.length) {
    console.warn(
      "[push] WhatsApp inbound: no recipients | owner:",
      ownerUserId ?? "(none)",
      "| business:",
      businessE164
    );
    return;
  }

  const labelUserId = ownerUserId ?? recipients[0];
  const label = await waContactLabel(labelUserId, params.peerE164);
  const preview = params.bodyPreview?.trim()
    ? truncate(params.bodyPreview, 120)
    : "New WhatsApp message";

  const payload = {
    title: label,
    body: preview,
    data: { type: "whatsapp", peer: params.peerE164 },
  };

  let sentCount = 0;
  for (const userId of recipients) {
    const tokens = await tokensForUser(userId);
    if (!tokens.length) continue;
    const invalid = await sendExpoPush(tokens, payload);
    if (invalid.length) {
      try {
        const svc = createServiceSupabase();
        await svc.from("push_device_tokens").delete().in("expo_push_token", invalid);
      } catch {
        /* ignore */
      }
    }
    sentCount += tokens.length;
  }

  if (sentCount === 0) {
    console.warn(
      "[push] WhatsApp notify: 0 tokens sent | recipients:",
      recipients.length,
      "| owner:",
      ownerUserId ?? "(none)",
      "| business:",
      businessE164
    );
  } else {
    console.log(
      "[push] WhatsApp notify | recipients:",
      recipients.length,
      "| tokens:",
      sentCount,
      "| peer:",
      params.peerE164,
      "| business:",
      businessE164
    );
  }
}

/** Resolve saved WhatsApp/contact name for a phone number (shared contact book). */
async function contactLabelForPhone(ownerUserId: string, peerE164: string): Promise<string> {
  try {
    const svc = createServiceSupabase();
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
  } catch {
    return formatPeer(peerE164);
  }
}

/** Alert agent on device while Exotel rings their mobile (shows real caller, not virtual CLI). */
export async function notifyIncomingCall(params: {
  userId: string;
  callerE164: string;
  callSid?: string;
}): Promise<void> {
  const userId = params.userId?.trim();
  const caller = params.callerE164?.trim();
  if (!userId || !caller) return;

  const tokens = await tokensForUser(userId);
  if (!tokens.length) {
    console.warn("[push] incoming call: no token for user", userId);
    return;
  }

  const label = await contactLabelForPhone(userId, caller);
  const payload = {
    title: `Incoming call — ${label}`,
    body: formatPeer(caller),
    channelId: "calls",
    data: {
      type: "incoming_call",
      peer: caller,
      callSid: params.callSid?.trim() ?? "",
    },
  };

  const invalid = await sendExpoPush(tokens, payload);
  if (invalid.length) {
    try {
      const svc = createServiceSupabase();
      await svc.from("push_device_tokens").delete().in("expo_push_token", invalid);
    } catch {
      /* ignore */
    }
  } else {
    console.log("[push] incoming call notify | user:", userId, "| caller:", caller);
  }
}

export async function sendTestIncomingCallPush(
  userId: string,
  callerE164 = "+919999999999"
): Promise<{ sent: number }> {
  const tokens = await tokensForUser(userId);
  if (!tokens.length) {
    throw new Error("No push tokens for this user. Open the app, allow notifications, sign in.");
  }
  await notifyIncomingCall({
    userId,
    callerE164,
    callSid: `test_${Date.now()}`,
  });
  return { sent: tokens.length };
}

export async function sendTestPushToUser(userId: string): Promise<{ sent: number }> {
  const tokens = await tokensForUser(userId);
  if (!tokens.length) {
    throw new Error("No push tokens for this user. Open the app, allow notifications, sign in.");
  }
  await sendExpoPush(tokens, {
    title: "The Nucleus",
    body: "Test — WhatsApp push works.",
    data: { type: "whatsapp", peer: "" },
  });
  return { sent: tokens.length };
}
