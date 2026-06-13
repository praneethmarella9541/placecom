/**
 * Shared talk-time helpers for call_logs rows (analytics, API, web).
 * Prefer conversation/recording duration; never use total duration unless
 * a recording proves the call was answered.
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

/** Talk seconds for billing and display; 0 when unanswered or unknown. */
export function callTalkSecondsFromRow(row: CallTalkRow): number {
  if (!isAnsweredCallRow(row)) return 0;

  const recDur = Number(row.recording_duration_seconds ?? 0) || 0;
  const convDur = Number(row.conversation_duration_seconds ?? 0) || 0;
  if (recDur > 0) return Math.round(recDur);
  if (convDur > 0) return Math.round(convDur);

  // Recording exists but Exotel omitted leg durations — use total duration as
  // best-effort until a refresh backfills conversation_duration_seconds.
  if (row.recording_sid) {
    const total = Number(row.duration_seconds ?? 0) || 0;
    if (total > 0) return Math.round(total);
  }
  return 0;
}

export function rowNeedsTalkDurationBackfill(row: CallTalkRow & { call_sid?: string | null }): boolean {
  if (!row.call_sid || row.call_sid.startsWith("pending_") || row.call_sid.startsWith("exotel_")) {
    return false;
  }
  if (!isAnsweredCallRow(row)) return false;
  return callTalkSecondsFromRow(row) <= 0;
}
