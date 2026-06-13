import "server-only";

import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { deriveCallDirection, resolveCallStatus } from "@/lib/call-status";
import {
  exotelConversationSeconds,
  exotelRecordingSeconds,
  exotelTotalSeconds,
  type ExotelCallLike,
} from "@/lib/exotel-call-durations";

async function fetchRecordingDurationSeconds(callSid: string): Promise<number | null> {
  const sid = process.env.EXOTEL_SID?.trim();
  const apiKey = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;

  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  try {
    const res = await fetch(
      `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}/Recordings.json`,
      { headers: { Authorization: `Basic ${basic}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const list = json?.TwilioResponse?.RecordingList?.Recording;
    type Rec = { Duration?: string | number };
    const recordings: Rec[] = Array.isArray(list) ? list : list ? [list] : [];
    const duration = recordings[0]?.Duration;
    if (duration == null) return null;
    const n = parseInt(String(duration), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Fetch one call from Exotel and return DB patch fields (or null). */
export async function fetchExotelCallPatch(
  callSid: string,
  fromNumber?: string | null
): Promise<Record<string, unknown> | null> {
  const sid = process.env.EXOTEL_SID?.trim();
  const apiKey = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;
  if (!callSid || callSid.startsWith("pending_") || callSid.startsWith("exotel_")) return null;

  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

  try {
    const detailsRes = await fetch(
      `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}.json?details=true`,
      { headers: { Authorization: `Basic ${basic}` } }
    );
    if (!detailsRes.ok) return null;
    const json = await detailsRes.json();
    const call = (json?.Call ?? json?.TwilioResponse?.Call ?? null) as ExotelCallLike | null;
    if (!call) return null;

    const status = ((call as { Status?: string }).Status ?? "").toLowerCase();
    if (!["completed", "busy", "no-answer", "failed", "canceled", "cancelled"].includes(status)) {
      return null;
    }

    const conversationSeconds = exotelConversationSeconds(call);
    let recordingSeconds = exotelRecordingSeconds(call);
    const totalSeconds = exotelTotalSeconds(call);
    const recordingUrl = (call as { RecordingUrl?: string }).RecordingUrl;

    if (!recordingSeconds && recordingUrl) {
      recordingSeconds = await fetchRecordingDurationSeconds(callSid);
    }

    const virtuals = listConfiguredExotelNumbers().map((v) => normalizePhone(v));
    const direction = deriveCallDirection(fromNumber, virtuals, phoneMatches);
    const mapped = resolveCallStatus(
      {
        status: (call as { Status?: string }).Status,
        duration: totalSeconds ?? undefined,
        conversationDuration: conversationSeconds ?? undefined,
        recordingDuration: recordingSeconds ?? undefined,
        hasRecording: !!recordingUrl,
      },
      direction
    );

    const updates: Record<string, unknown> = {
      status: mapped,
      updated_at: new Date().toISOString(),
    };
    if (recordingSeconds != null) {
      updates.recording_duration_seconds = recordingSeconds;
    }
    if (conversationSeconds != null) {
      updates.conversation_duration_seconds = conversationSeconds;
    }
    if (totalSeconds != null) updates.duration_seconds = totalSeconds;
    if ((call as { StartTime?: string }).StartTime) {
      try {
        updates.started_at = new Date((call as { StartTime: string }).StartTime).toISOString();
      } catch {
        /* ignore */
      }
    }
    const endTime = (call as { EndTime?: string }).EndTime;
    if (endTime && endTime !== "1970-01-01 05:30:00") {
      try {
        updates.ended_at = new Date(endTime).toISOString();
      } catch {
        /* ignore */
      }
    }
    if (recordingUrl) updates.recording_sid = recordingUrl;

    return updates;
  } catch (e) {
    console.error("[exotel-call-refresh] failed:", (e as Error).message);
    return null;
  }
}
