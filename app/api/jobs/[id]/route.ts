import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { ExtractionEmailPayload } from "@/lib/extraction-types";

const JOB_SELECT =
  "id, status, total_emails, processed_emails, created_at, openai_input_tokens, openai_output_tokens, openai_cost_usd, next_batch_index, batch_count, error_message, fetched_count, skipped_count, pending_emails";

const JOB_SELECT_CORE =
  "id, status, total_emails, processed_emails, created_at";

const ALLOWED_STATUS = new Set([
  "pending",
  "running",
  "done",
  "error",
  "partial",
]);

type RouteContext = { params: { id: string } | Promise<{ id: string }> };

async function resolveJobId(context: RouteContext): Promise<string | null> {
  const params =
    context.params instanceof Promise ? await context.params : context.params;
  const id = params.id?.trim();
  return id || null;
}

function jobErrorResponse(error: { message?: string; code?: string } | null, id: string) {
  const message = error?.message?.trim();
  if (message) {
    const missingColumn =
      /column.+does not exist/i.test(message) ||
      /schema cache/i.test(message);
    if (missingColumn) {
      return NextResponse.json(
        {
          error:
            "Extraction database is out of date. Apply Supabase migrations 0005_openai_job_usage.sql and 0022_extraction_job_resume.sql, then try again.",
        },
        { status: 500 }
      );
    }
    if (error?.code === "PGRST116") {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("[jobs/:id]", id, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ error: "Job not found" }, { status: 404 });
}

function isEmailPayloadArray(x: unknown): x is ExtractionEmailPayload[] {
  if (!Array.isArray(x)) return false;
  return x.every(
    (e) =>
      e &&
      typeof e === "object" &&
      typeof (e as ExtractionEmailPayload).id === "string"
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const id = await resolveJobId(context);
  if (!id) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let result = await supabase
    .from("extraction_jobs")
    .select(JOB_SELECT)
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (result.error && /column|schema cache/i.test(result.error.message ?? "")) {
    result = await supabase
      .from("extraction_jobs")
      .select(JOB_SELECT_CORE)
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
  }

  if (result.error || !result.data) {
    return jobErrorResponse(result.error, id);
  }

  return NextResponse.json({ job: result.data });
}

export async function PATCH(request: Request, context: RouteContext) {
  const id = await resolveJobId(context);
  if (!id) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

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
    .select(JOB_SELECT_CORE)
    .single();

  if (error || !job) {
    return jobErrorResponse(error, id);
  }

  return NextResponse.json({ job });
}
