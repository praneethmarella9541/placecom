import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";

export const runtime = "nodejs";

/** GET /api/push/debug — why WhatsApp push might not arrive (auth required). */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const business = searchParams.get("business")?.trim() ?? "";

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch (e) {
    return NextResponse.json({
      error: "SUPABASE_SERVICE_ROLE_KEY missing on Vercel",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("role, exotel_virtual_number, mailbox_owner_id, restricted_features")
    .eq("id", user.id)
    .maybeSingle();

  const { data: myTokens } = await svc
    .from("push_device_tokens")
    .select("expo_push_token, platform, updated_at")
    .eq("user_id", user.id);

  const ownerForLine = business ? await findUserIdForBusinessLine(business) : null;

  const { count: totalTokens } = await svc
    .from("push_device_tokens")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    userId: user.id,
    profile: {
      role: profile?.role ?? null,
      exotel_virtual_number: profile?.exotel_virtual_number ?? null,
      mailbox_owner_id: profile?.mailbox_owner_id ?? null,
      restricted_features: profile?.restricted_features ?? null,
    },
    myPushTokens: (myTokens ?? []).length,
    tokens: myTokens ?? [],
    configuredExotelNumbers: listConfiguredExotelNumbers(),
    businessLineQuery: business || null,
    ownerUserIdForBusinessLine: ownerForLine,
    amILineOwner: ownerForLine === user.id,
    totalPushTokensInDb: totalTokens ?? 0,
    hints: [
      !myTokens?.length
        ? "No push token for your user — open app, allow notifications, sign in."
        : null,
      business && !ownerForLine
        ? "No Team profile matches this business line — set exotel_virtual_number in Admin → Team."
        : null,
      business && ownerForLine && ownerForLine !== user.id
        ? "Push goes to line owner + staff + users with tokens; redeploy latest placecom if still failing."
        : null,
      !business
        ? "Add ?business=+91XXXXXXXXXX (your Exotel line) to check line ownership."
        : null,
    ].filter(Boolean),
  });
}
