import "server-only";

import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { deriveCallDirection, resolveCallStatus } from "@/lib/call-status";

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
      `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}.json`,
      { headers: { Authorization: `Basic ${basic}` } }
    );
    if (!detailsRes.ok) return null;
    const json = await detailsRes.json();
    const call = json?.Call ?? json?.TwilioResponse?.Call ?? null;
    if (!call) return null;

    const status = (call.Status ?? "").toLowerCase();
    if (!["completed", "busy", "no-answer", "failed", "canceled", "cancelled"].includes(status)) {
      return null;
    }

    const virtuals = listConfiguredExotelNumbers().map((v) => normalizePhone(v));
    const direction = deriveCallDirection(fromNumber, virtuals, phoneMatches);
    const mapped = resolveCallStatus(
      {
        status: call.Status,
        duration: call.Duration,
        conversationDuration: call.ConversationDuration,
        recordingDuration: call.RecordingDuration,
        hasRecording: !!call.RecordingUrl,
      },
      direction
    );

    const updates: Record<string, unknown> = {
      status: mapped,
      updated_at: new Date().toISOString(),
    };
    if (call.RecordingDuration != null) {
      updates.recording_duration_seconds = parseInt(String(call.RecordingDuration), 10) || null;
    }
    if (call.ConversationDuration != null) {
      updates.conversation_duration_seconds = parseInt(String(call.ConversationDuration), 10) || null;
    }
    if (call.Duration) updates.duration_seconds = parseInt(String(call.Duration), 10) || null;
    if (call.StartTime) {
      try {
        updates.started_at = new Date(call.StartTime).toISOString();
      } catch {
        /* ignore */
      }
    }
    if (call.EndTime && call.EndTime !== "1970-01-01 05:30:00") {
      try {
        updates.ended_at = new Date(call.EndTime).toISOString();
      } catch {
        /* ignore */
      }
    }
    if (call.RecordingUrl) updates.recording_sid = call.RecordingUrl;

    return updates;
  } catch (e) {
    console.error("[exotel-call-refresh] failed:", (e as Error).message);
    return null;
  }
}
