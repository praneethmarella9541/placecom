import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let total_emails = 0;
  try {
    const body = (await request.json()) as { total_emails?: number };
    if (typeof body.total_emails === "number" && body.total_emails >= 0) {
      total_emails = body.total_emails;
    }
  } catch {
    // empty body ok
  }

  const { data: job, error } = await supabase
    .from("extraction_jobs")
    .insert({
      user_id: user.id,
      status: "pending",
      total_emails,
      processed_emails: 0,
    })
    .select("id, status, total_emails, processed_emails, created_at")
    .single();

  if (error || !job) {
    console.error(error);
    return NextResponse.json(
      { error: error?.message || "Failed to create job" },
      { status: 500 }
    );
  }

  return NextResponse.json({ job });
}
