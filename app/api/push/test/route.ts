import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { sendExpoPush } from "@/lib/expo-push";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";

/** POST /api/push/test — send a test notification to the signed-in user's devices. */
export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Service role not configured" }, { status: 500 });
  }

  const { data: rows, error } = await svc
    .from("push_device_tokens")
    .select("expo_push_token")
    .eq("user_id", user.id);

  if (error) {
    if (/push_device_tokens/i.test(error.message)) {
      return NextResponse.json(
        { error: "Run migration 0029_push_notifications.sql" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tokens = (rows ?? []).map((r) => r.expo_push_token as string).filter(Boolean);
  if (!tokens.length) {
    return NextResponse.json(
      { error: "No push tokens for this user. Open the app, allow notifications, and sign in." },
      { status: 404 }
    );
  }

  const invalid = await sendExpoPush(tokens, {
    title: "The Nucleus",
    body: "Test notification — push delivery works.",
    data: { type: "inbox" },
  });

  return NextResponse.json({
    ok: true,
    sent: tokens.length,
    invalidTokensRemoved: invalid.length,
  });
}
