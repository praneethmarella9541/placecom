import { NextResponse } from "next/server";
import { getExtractHttpBatchSize } from "@/lib/extract-config";
import { extractEmailsWithOpenAI } from "@/lib/openai-extract";
import { assertUserWithinTokenLimit } from "@/lib/openai-token-limit";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

type IncomingEmail = {
  id: string;
  subject?: string;
  body?: string;
  from?: string;
  date?: string;
  position?: number;
  /** `data:image/…;base64,…` from Gmail for vision */
  images?: string[];
};

type BatchBody = {
  jobId: string;
  jobTotalEmails: number;
  batchIndex: number;
  batchCount: number;
  emails: IncomingEmail[];
};

type FullBody = {
  emails: IncomingEmail[];
};

type JobUsageRow = {
  openai_input_tokens: number | null;
  openai_output_tokens: number | null;
  openai_cost_usd: number | null;
};

async function bumpJobOpenAIUsage(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  jobId: string,
  delta: { input: number; output: number; cost: number }
): Promise<{
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiCostUsd: number;
}> {
  const { data, error } = await supabase
    .from("extraction_jobs")
    .select("openai_input_tokens, openai_output_tokens, openai_cost_usd")
    .eq("id", jobId)
    .single();

  if (error || !data) {
    return {
      openaiInputTokens: delta.input,
      openaiOutputTokens: delta.output,
      openaiCostUsd: delta.cost,
    };
  }

  const row = data as JobUsageRow;
  const prevIn = Number(row.openai_input_tokens) || 0;
  const prevOut = Number(row.openai_output_tokens) || 0;
  const prevCost = Number(row.openai_cost_usd) || 0;
  const openaiInputTokens = prevIn + delta.input;
  const openaiOutputTokens = prevOut + delta.output;
  const openaiCostUsd = Number((prevCost + delta.cost).toFixed(6));

  await supabase
    .from("extraction_jobs")
    .update({
      openai_input_tokens: openaiInputTokens,
      openai_output_tokens: openaiOutputTokens,
      openai_cost_usd: openaiCostUsd,
    })
    .eq("id", jobId);

  return { openaiInputTokens, openaiOutputTokens, openaiCostUsd };
}

function isBatchBody(x: Record<string, unknown>): x is BatchBody {
  return (
    typeof x.jobId === "string" &&
    typeof x.jobTotalEmails === "number" &&
    typeof x.batchIndex === "number" &&
    typeof x.batchCount === "number" &&
    Array.isArray(x.emails)
  );
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokenCheck = await assertUserWithinTokenLimit(user.id);
  if (!tokenCheck.ok) {
    return NextResponse.json(
      { error: tokenCheck.message, tokenLimit: tokenCheck.status },
      { status: 429 }
    );
  }

  const CHUNK = getExtractHttpBatchSize();

  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (isBatchBody(raw)) {
    const { jobId, jobTotalEmails, batchIndex, batchCount, emails } = raw;

    if (emails.length === 0 || emails.length > CHUNK) {
      return NextResponse.json(
        { error: `Send between 1 and ${CHUNK} emails per batch` },
        { status: 400 }
      );
    }

    if (batchIndex < 0 || batchIndex >= batchCount) {
      return NextResponse.json({ error: "Invalid batchIndex" }, { status: 400 });
    }

    const { data: jobRow, error: jobErr } = await supabase
      .from("extraction_jobs")
      .select("id, user_id, total_emails, processed_emails, status")
      .eq("id", jobId)
      .single();

    if (jobErr || !jobRow || jobRow.user_id !== user.id) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (jobTotalEmails > 0 && jobRow.total_emails !== jobTotalEmails) {
      await supabase
        .from("extraction_jobs")
        .update({ total_emails: jobTotalEmails })
        .eq("id", jobId);
    }

    await supabase
      .from("extraction_jobs")
      .update({ status: "running" })
      .eq("id", jobId);

    try {
      const payloadIn = emails.map((e) => ({
        id: e.id,
        subject: e.subject ?? "",
        body: e.body ?? "",
        from: e.from ?? "",
        ...(Array.isArray(e.images) && e.images.length > 0 ? { images: e.images } : {}),
      }));

      const { results: chunkResults, usage, costUsd } =
        await extractEmailsWithOpenAI(payloadIn);

      const rows = chunkResults.map((r) => {
        const src = emails.find((s) => s.id === r.id);
        return {
          job_id: jobId,
          user_id: user.id,
          email_id: r.id,
          subject: src?.subject ?? null,
          body: src?.body ?? null,
          sender: src?.from ?? null,
          extracted_names: r.names,
          extracted_phones: r.phones,
          extracted_emails: r.emails,
          extracted_contacts: r.contacts,
          position: src?.position ?? null,
        };
      });

      const { error: insErr } = await supabase
        .from("email_extractions")
        .upsert(rows, { onConflict: "user_id,email_id" });

      if (insErr) {
        throw new Error(insErr.message);
      }

      const newProcessed = (jobRow.processed_emails || 0) + emails.length;
      const isLast = batchIndex === batchCount - 1;

      await bumpJobOpenAIUsage(supabase, jobId, {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        cost: costUsd,
      });

      const jobUpdate: Record<string, unknown> = {
        processed_emails: newProcessed,
        total_emails: jobTotalEmails,
        next_batch_index: batchIndex + 1,
        error_message: null,
        status: isLast ? "done" : "running",
      };
      if (isLast) {
        jobUpdate.pending_emails = null;
        jobUpdate.batch_count = batchCount;
      }

      await supabase.from("extraction_jobs").update(jobUpdate).eq("id", jobId);

      return NextResponse.json({
        jobId,
        batchIndex,
        processedEmails: newProcessed,
        totalEmails: jobTotalEmails,
        results: chunkResults,
        done: isLast,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed";
      await supabase
        .from("extraction_jobs")
        .update({
          status: "partial",
          error_message: msg.slice(0, 2000),
          next_batch_index: batchIndex,
          batch_count: batchCount,
        })
        .eq("id", jobId);
      console.error(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const emails = (raw as FullBody).emails;
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json(
      { error: "Provide either batched fields (jobId, \u2026) or { emails: [...] }" },
      { status: 400 }
    );
  }

  const { data: job, error: jobErr } = await supabase
    .from("extraction_jobs")
    .insert({
      user_id: user.id,
      status: "running",
      total_emails: emails.length,
      processed_emails: 0,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    console.error(jobErr);
    return NextResponse.json(
      { error: jobErr?.message || "Failed to create job" },
      { status: 500 }
    );
  }

  const jobId = job.id;
  type FlatResult = {
    id: string;
    names: string[];
    phones: string[];
    emails: string[];
    contacts: { name: string | null; email: string | null; phone: string | null }[];
  };
  const processed: FlatResult[] = [];
  try {
    for (let i = 0; i < emails.length; i += CHUNK) {
      const slice = emails.slice(i, i + CHUNK);
      const payloadIn = slice.map((e) => ({
        id: e.id,
        subject: e.subject ?? "",
        body: e.body ?? "",
        from: e.from ?? "",
        ...(Array.isArray(e.images) && e.images.length > 0 ? { images: e.images } : {}),
      }));

      const { results: chunkResults, usage, costUsd } =
        await extractEmailsWithOpenAI(payloadIn);
      processed.push(...chunkResults);

      const rows = chunkResults.map((r, idx) => {
        const src = slice.find((s) => s.id === r.id);
        return {
          job_id: jobId,
          user_id: user.id,
          email_id: r.id,
          subject: src?.subject ?? null,
          body: src?.body ?? null,
          sender: src?.from ?? null,
          extracted_names: r.names,
          extracted_phones: r.phones,
          extracted_emails: r.emails,
          extracted_contacts: r.contacts,
          position: src?.position ?? i + idx,
        };
      });

      const { error: insErr } = await supabase
        .from("email_extractions")
        .upsert(rows, { onConflict: "user_id,email_id" });

      if (insErr) {
        throw new Error(insErr.message);
      }

      await bumpJobOpenAIUsage(supabase, jobId, {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        cost: costUsd,
      });

      await supabase
        .from("extraction_jobs")
        .update({ processed_emails: Math.min(i + slice.length, emails.length) })
        .eq("id", jobId);
    }

    await supabase
      .from("extraction_jobs")
      .update({ status: "done", processed_emails: emails.length })
      .eq("id", jobId);

    return NextResponse.json({
      jobId,
      results: processed,
      total: processed.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extraction failed";
    await supabase
      .from("extraction_jobs")
      .update({ status: "error" })
      .eq("id", jobId);
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
