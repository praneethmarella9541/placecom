import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job, error } = await supabase
    .from("extraction_jobs")
    .select("id, status, total_emails, processed_emails, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { total_emails?: number; status?: string };
  try {
    body = (await request.json()) as { total_emails?: number; status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.total_emails === "number") {
    updates.total_emails = body.total_emails;
  }
  if (body.status) {
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  const { data: job, error } = await supabase
    .from("extraction_jobs")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, status, total_emails, processed_emails, created_at")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
