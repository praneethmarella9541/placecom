import "server-only";

import { sendExpoPush } from "@/lib/expo-push";
import { createServiceSupabase } from "@/lib/supabase-service";

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

/** Verifies the signed-in user's device can actually receive a push — used by the mobile app's notification-permission settings screen. */
export async function sendTestPushToUser(userId: string): Promise<{ sent: number }> {
  const tokens = await tokensForUser(userId);
  if (!tokens.length) {
    throw new Error("No push tokens for this user. Open the app, allow notifications, sign in.");
  }
  await sendExpoPush(tokens, {
    title: "The Nucleus",
    body: "Test push notification — this worked!",
    data: { type: "test" },
  });
  return { sent: tokens.length };
}
