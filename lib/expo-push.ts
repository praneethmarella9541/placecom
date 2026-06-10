import "server-only";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export type ExpoPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Android notification channel (e.g. `calls` for incoming call alerts). */
  channelId?: string;
  /** Image URL for rich notifications (Android out of the box; iOS needs a service extension). */
  richContent?: { image: string };
  /** Required on iOS for the notification service extension to attach images. */
  mutableContent?: boolean;
};
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
export async function sendExpoPush(tokens: string[], payload: ExpoPushPayload): Promise<string[]> {
  const valid = tokens.filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["));
  if (!valid.length) return [];
  const invalid: string[] = [];
  for (const batch of chunk(valid, 100)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((to) => ({
          to,
          sound: "default",
          priority: "high",
          channelId: payload.channelId ?? "default",
          ...payload,
        }))
      ),
    });
    if (!res.ok) {
      console.error("[expo-push] HTTP", res.status, await res.text().catch(() => ""));
      continue;
    }
    const body = (await res.json()) as {
      data?: { status?: string; message?: string; details?: { error?: string } }[];
    };
    (body.data ?? []).forEach((ticket, i) => {
      if (ticket.status !== "error") return;
      console.warn("[expo-push] ticket error:", ticket.message, ticket.details);
      if (ticket.details?.error === "DeviceNotRegistered" && batch[i]) invalid.push(batch[i]);
    });
  }
  return invalid;
}
