import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { computeEmailConnection } from "@/lib/lead-email-connection";

export const runtime = "nodejs";

const CACHE_TTL_MS = 15 * 60 * 1000;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, email, email_last_interaction_at, email_connection_strength, email_synced_at")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (!lead.email) {
    return NextResponse.json({ error: "Lead has no email address" }, { status: 400 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const syncedAt = lead.email_synced_at ? new Date(lead.email_synced_at).getTime() : 0;
  if (!force && syncedAt && Date.now() - syncedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      lastInteractionAt: lead.email_last_interaction_at,
      connectionStrength: lead.email_connection_strength,
      cached: true,
    });
  }

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const result = await computeEmailConnection(auth.accessToken, lead.email);
    const email_synced_at = new Date().toISOString();

    await supabase
      .from("leads")
      .update({
        email_last_interaction_at: result.lastInteractionAt,
        email_connection_strength: result.connectionStrength,
        email_synced_at,
      })
      .eq("id", lead.id)
      .eq("user_id", user.id);

    return NextResponse.json({
      lastInteractionAt: result.lastInteractionAt,
      connectionStrength: result.connectionStrength,
      cached: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to compute email connection";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
