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

  let query = supabase
    .from("email_tracking")
    .select("id, gmail_message_id, to_address, subject, sent_at, opened, opened_at, open_count")
    .eq("user_id", user.id)
    .order("sent_at", { ascending: false });

  if (messageIds) {
    const ids = messageIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      query = query.in("gmail_message_id", ids);
    }
  }

  const { data, error } = await query.limit(200);

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ tracking: [] });
    }
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tracking: data || [] });
}
