/**
 * Shared talk-time helpers for call_logs rows (analytics, API, web).
 * Use Exotel ConversationDuration / RecordingDuration only — never total
 * call Duration (includes ringing).
 */

export type CallTalkRow = {
  status?: string | null;
  conversation_duration_seconds?: number | null;
  recording_duration_seconds?: number | null;
  recording_sid?: string | null;
  duration_seconds?: number | null;
};

const UNANSWERED_STATUSES = new Set([
  "no-answer",
  "missed",
  "busy",
  "failed",
  "canceled",
  "cancelled",
]);

export function isAnsweredCallRow(row: CallTalkRow): boolean {
  const status = (row.status ?? "").toLowerCase();
  if (UNANSWERED_STATUSES.has(status)) return false;
  if (row.recording_sid) return true;
  if (Number(row.recording_duration_seconds ?? 0) > 0) return true;
  if (Number(row.conversation_duration_seconds ?? 0) > 0) return true;
  return false;
}

/** Stored talk duration likely equals total call time (ring + talk). */
export function talkTimeLooksInflated(row: CallTalkRow): boolean {
  const total = Number(row.duration_seconds ?? 0) || 0;
  if (total <= 0) return false;
  const recDur = Number(row.recording_duration_seconds ?? 0) || 0;
  const convDur = Number(row.conversation_duration_seconds ?? 0) || 0;
  const talk = Math.max(recDur, convDur);
  if (talk <= 0) return false;
  return talk >= total - 3;
}

/** Talk seconds for billing and display; 0 when unanswered or unknown. */
export function callTalkSecondsFromRow(row: CallTalkRow): number {
  if (!isAnsweredCallRow(row)) return 0;

  const convDur = Number(row.conversation_duration_seconds ?? 0) || 0;
  const recDur = Number(row.recording_duration_seconds ?? 0) || 0;

  // Exotel dashboard "Total Talk Time" = ConversationDuration.
  if (convDur > 0) return Math.round(convDur);

  if (recDur > 0 && !talkTimeLooksInflated(row)) return Math.round(recDur);

  return 0;
}

export function rowNeedsTalkDurationBackfill(
  row: CallTalkRow & { call_sid?: string | null }
): boolean {
  if (!row.call_sid || row.call_sid.startsWith("pending_") || row.call_sid.startsWith("exotel_")) {
    return false;
  }
  if (!isAnsweredCallRow(row)) return false;

  const convDur = Number(row.conversation_duration_seconds ?? 0) || 0;
  if (convDur > 0 && !talkTimeLooksInflated(row)) return false;

  // Missing conversation duration or inflated recording/total stored as talk.
  return convDur <= 0 || talkTimeLooksInflated(row);
}
