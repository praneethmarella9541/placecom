import "server-only";
import { normalizeRestrictedFeatures, type FeatureKey } from "@/lib/feature-access";
import { sendExpoPush } from "@/lib/expo-push";
import { createServiceSupabase } from "@/lib/supabase-service";
import { peerKeysForQuery } from "@/lib/whatsapp-peer";

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
function formatPeer(peer: string): string {
  return peer.startsWith("+91") && peer.length === 13 ? `+91 ${peer.slice(3, 8)} ${peer.slice(8)}` : peer;
}

async function userHasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc.from("profiles").select("role, restricted_features").eq("id", userId).maybeSingle();
    if (!data) return true;
    const role = data.role as string;
    if (role === "admin" || role === "staff") return true;
    return !normalizeRestrictedFeatures(data.restricted_features).includes(feature);
  } catch { return true; }
}

async function tokensForUser(userId: string): Promise<string[]> {
  try {
    const svc = createServiceSupabase();
    const { data, error } = await svc.from("push_device_tokens").select("expo_push_token").eq("user_id", userId);
    if (error) return [];
    return (data ?? []).map((r) => r.expo_push_token as string).filter(Boolean);
  } catch { return []; }
}

async function sendToUser(userId: string, payload: { title: string; body: string; data?: Record<string, string> }): Promise<boolean> {
  if (!(await userHasFeature(userId, "whatsapp"))) return false;
  const tokens = await tokensForUser(userId);
  if (!tokens.length) return false;
  await sendExpoPush(tokens, payload);
  return true;
}

export async function notifyWhatsAppInbound(params: {
  ownerUserId: string | null;
  peerE164: string;
  bodyPreview: string | null;
}): Promise<void> {
  if (!params.ownerUserId) return;
  let label = formatPeer(params.peerE164);
  try {
    const svc = createServiceSupabase();
    const keys = peerKeysForQuery(params.peerE164);
    const { data } = await svc.from("wa_contacts").select("name").eq("user_id", params.ownerUserId).in("peer_e164", keys).limit(1);
    if (data?.[0]?.name) label = (data[0].name as string).trim();
  } catch { /* ignore */ }
  await sendToUser(params.ownerUserId, {
    title: label,
    body: params.bodyPreview?.trim() ? truncate(params.bodyPreview, 120) : "New WhatsApp message",
    data: { type: "whatsapp", peer: params.peerE164 },
  });
}

export async function sendTestPushToUser(userId: string): Promise<{ sent: number }> {
  const tokens = await tokensForUser(userId);
  if (!tokens.length) throw new Error("No push tokens registered for this user.");
  await sendExpoPush(tokens, { title: "The Nucleus", body: "Test — WhatsApp push works.", data: { type: "whatsapp", peer: "" } });
  return { sent: tokens.length };
}
