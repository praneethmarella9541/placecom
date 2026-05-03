import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  // Fetch meeting recordings matching the lead's email
  const { data: meetings, error } = await supabase
    .from("meeting_recordings")
    .select("*")
    .eq("user_id", user.id)
    .eq("attendee_email", email)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET Meetings error:", error);
    return NextResponse.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ meetings });
}
