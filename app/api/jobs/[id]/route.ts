import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { ExtractionEmailPayload } from "@/lib/extraction-types";

const JOB_SELECT =
  "id, status, total_emails, processed_emails, created_at, openai_input_tokens, openai_output_tokens, openai_cost_usd, next_batch_index, batch_count, error_message, fetched_count, skipped_count, pending_emails";

const ALLOWED_STATUS = new Set([
  "pending",
  "running",
  "done",
  "error",
  "partial",
]);

function isEmailPayloadArray(x: unknown): x is ExtractionEmailPayload[] {
  if (!Array.isArray(x)) return false;
  return x.every(
    (e) =>
      e &&
      typeof e === "object" &&
      typeof (e as ExtractionEmailPayload).id === "string"
  );
}

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
    .select(JOB_SELECT)
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.total_emails === "number") {
    updates.total_emails = body.total_emails;
  }
  if (typeof body.processed_emails === "number") {
    updates.processed_emails = body.processed_emails;
  }
  if (typeof body.next_batch_index === "number") {
    updates.next_batch_index = Math.max(0, Math.floor(body.next_batch_index));
  }
  if (typeof body.batch_count === "number") {
    updates.batch_count = Math.max(0, Math.floor(body.batch_count));
  }
  if (typeof body.fetched_count === "number") {
    updates.fetched_count = Math.max(0, Math.floor(body.fetched_count));
  }
  if (typeof body.skipped_count === "number") {
    updates.skipped_count = Math.max(0, Math.floor(body.skipped_count));
  }
  if (body.error_message === null) {
    updates.error_message = null;
  } else if (typeof body.error_message === "string") {
    updates.error_message = body.error_message.slice(0, 2000);
  }
  if (body.pending_emails === null) {
    updates.pending_emails = null;
  } else if (isEmailPayloadArray(body.pending_emails)) {
    updates.pending_emails = body.pending_emails;
  }
  if (typeof body.status === "string" && ALLOWED_STATUS.has(body.status)) {
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
    .select(JOB_SELECT)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
