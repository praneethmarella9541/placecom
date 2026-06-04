import "server-only";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
  );
}

/** Send push notifications via Expo Push API. Returns tokens Expo marked as invalid. */
export async function sendExpoPush(
  tokens: string[],
  payload: ExpoPushPayload
): Promise<string[]> {
  const valid = tokens.filter(isExpoPushToken);
  if (!valid.length) return [];

  const invalid: string[] = [];

  for (const batch of chunk(valid, 100)) {
    const messages = batch.map((to) => ({
      to,
      sound: "default" as const,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    }));

    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });
    } catch (e) {
      console.error("[expo-push] network error:", e);
      continue;
    }

    if (!res.ok) {
      console.error("[expo-push] HTTP", res.status, await res.text().catch(() => ""));
      continue;
    }

    const body = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = body.data ?? [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "error") {
        const err = ticket.details?.error ?? ticket.message;
        if (err === "DeviceNotRegistered" && batch[i]) invalid.push(batch[i]);
        else console.warn("[expo-push] ticket error:", err, batch[i]?.slice(0, 24));
      }
    });
  }

  return invalid;
}
