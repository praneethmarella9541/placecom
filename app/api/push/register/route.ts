import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { ensureGmailPushCursor } from "@/lib/push-notifications";

export const runtime = "nodejs";

/** POST /api/push/register — store Expo push token for the signed-in user. */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    expo_push_token?: string;
    platform?: string;
  } | null;

  const token = body?.expo_push_token?.trim();
  if (!token) {
    return NextResponse.json({ error: "expo_push_token is required" }, { status: 400 });
  }

  const { error } = await supabase.from("push_device_tokens").upsert(
    {
      user_id: user.id,
      expo_push_token: token,
      platform: body?.platform?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,expo_push_token" }
  );

  if (error) {
    if (/push_device_tokens/i.test(error.message)) {
      return NextResponse.json(
        { error: "Push tokens table missing. Run migration 0029_push_notifications.sql." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await ensureGmailPushCursor(user.id);
  } catch (e) {
    console.warn("[push/register] gmail cursor init:", e);
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/push/register — remove one token or all tokens for this user. */
export async function DELETE(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { expo_push_token?: string } | null;
  const token = body?.expo_push_token?.trim();

  let q = supabase.from("push_device_tokens").delete().eq("user_id", user.id);
  if (token) q = q.eq("expo_push_token", token);

  const { error } = await q;
  if (error) {
    if (/push_device_tokens/i.test(error.message)) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
