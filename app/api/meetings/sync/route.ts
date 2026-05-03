import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  fetchRecentTranscripts,
  fetchTranscriptDetailForSync,
  isTranscriptReadyForSync,
  transcriptMatchesRecording,
  type FirefliesTranscriptListItem,
} from "@/lib/fireflies";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_UPDATES_PER_REQUEST = 8;
const MAX_TRANSCRIPT_PAGES = 6;

export async function POST() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FIREFLIES_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "FIREFLIES_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  const { data: rows, error: qErr } = await supabase
    .from("meeting_recordings")
    .select("id, meeting_url, fireflies_id, attendee_email, created_at, status")
    .eq("user_id", user.id)
    .neq("status", "completed");

  if (qErr) {
    console.error(qErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const pending = rows ?? [];
  if (pending.length === 0) {
    return NextResponse.json({
      updated: 0,
      skipped: 0,
      pendingCount: 0,
      transcriptsFetched: 0,
      message: "No meetings waiting for Fireflies data.",
    });
  }

  let oldestMs = new Date(pending[0].created_at).getTime();
  for (const r of pending) {
    const t = new Date(r.created_at).getTime();
    if (Number.isFinite(t) && t < oldestMs) oldestMs = t;
  }
  const fromDateIso = new Date(oldestMs - 48 * 60 * 60 * 1000).toISOString();

  const stopWhenAllMatched = (all: FirefliesTranscriptListItem[]) =>
    pending.every((rec) =>
      all.some((t) => transcriptMatchesRecording(t, rec) && isTranscriptReadyForSync(t))
    );

  let transcripts: FirefliesTranscriptListItem[] = [];
  try {
    transcripts = await fetchRecentTranscripts({
      fromDateIso,
      maxPages: MAX_TRANSCRIPT_PAGES,
      shouldStop: stopWhenAllMatched,
    });
  } catch (e) {
    console.warn("Fireflies transcripts with fromDate failed, retrying without filter:", e);
    try {
      transcripts = await fetchRecentTranscripts({
        maxPages: MAX_TRANSCRIPT_PAGES,
        shouldStop: stopWhenAllMatched,
      });
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "Fireflies request failed";
      console.error(e2);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  let updated = 0;
  let skipped = 0;

  for (const rec of pending) {
    if (updated >= MAX_UPDATES_PER_REQUEST) break;

    const ready = transcripts.filter(
      (t) => transcriptMatchesRecording(t, rec) && isTranscriptReadyForSync(t)
    );
    if (!ready.length) {
      skipped++;
      continue;
    }

    ready.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    const best = ready[0];

    try {
      const detail = await fetchTranscriptDetailForSync(best.id);
      if (detail.isLive) {
        skipped++;
        continue;
      }
      const st = detail.summaryStatus?.toLowerCase();
      if (st === "failed" || st === "skipped") {
        skipped++;
        continue;
      }
      const hasBody =
        (detail.summaryText && detail.summaryText.length > 0) ||
        (detail.transcriptText && detail.transcriptText.length >= 80);
      if (!hasBody) {
        skipped++;
        continue;
      }

      const { error: upErr } = await supabase
        .from("meeting_recordings")
        .update({
          fireflies_id: best.id,
          transcript: detail.transcriptText || null,
          summary: detail.summaryText || null,
          status: "completed",
        })
        .eq("id", rec.id)
        .eq("user_id", user.id);

      if (upErr) {
        console.error("meeting_recordings update:", upErr);
        skipped++;
        continue;
      }
      updated++;
    } catch (err) {
      console.error("Sync transcript detail:", err);
      skipped++;
    }
  }

  return NextResponse.json({
    updated,
    skipped,
    pendingCount: pending.length,
    transcriptsFetched: transcripts.length,
    message:
      updated === 0
        ? "No completed Fireflies transcripts matched your pending meetings yet."
        : `Updated ${updated} meeting(s) from Fireflies.`,
  });
}
