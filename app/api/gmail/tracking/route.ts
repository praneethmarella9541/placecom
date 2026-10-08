import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const messageIds = searchParams.get("messageIds");

  const ids = (messageIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const run = (columns: string) => {
    let q = supabase.from("email_tracking").select(columns).eq("user_id", user.id).order("sent_at", { ascending: false });
    if (ids.length > 0) q = q.in("gmail_message_id", ids);
    return q.limit(200);
  };

  const BASE =
    "id, gmail_message_id, to_address, subject, sent_at, opened, opened_at, open_count, campaign_id, campaign_name, replied, bounced";
  // With 0071: who else it went to and which addresses failed, for "Partly bounced".
  let { data, error } = await run(`${BASE}, cc_address, bcc_address, bounced_recipients`);
  if (error?.code === "42703") {
    ({ data, error } = await run(BASE));
  }

  // Migration 0063 (campaign_id/campaign_name/replied/bounced) not applied
  // yet on this environment — fall back to the pre-campaign column set rather
  // than failing the whole inbox's tracking pills over it, padding the new
  // fields so every row has a consistent shape for callers either way.
  if (error?.code === "42703") {
    let fallback = supabase
      .from("email_tracking")
      .select("id, gmail_message_id, to_address, subject, sent_at, opened, opened_at, open_count")
      .eq("user_id", user.id)
      .order("sent_at", { ascending: false });
    if (messageIds) {
      const ids = messageIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) fallback = fallback.in("gmail_message_id", ids);
    }
    const { data: fallbackData, error: fallbackError } = await fallback.limit(200);
    if (fallbackError) {
      console.error(fallbackError);
      return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    }
    const padded = (fallbackData || []).map((row) => ({
      ...row,
      campaign_id: null,
      campaign_name: null,
      replied: false,
      bounced: false,
    }));
    return NextResponse.json({ tracking: padded });
  }

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ tracking: [] });
    }
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tracking: data || [] });
}
