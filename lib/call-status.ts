/**
 * Normalises a raw Exotel call status into the status we store on `call_logs`.
 *
 * The problem this solves: for "connect two numbers" flows, Exotel's top-level
 * `Status` is often `completed` even when the destination party never answered
 * (the *call flow* completed, the *conversation* did not). Storing that verbatim
 * makes unanswered calls look like successful, completed calls.
 *
 * We therefore treat a call as genuinely answered only when there is real talk
 * time — a recording, a positive ConversationDuration, or a leg explicitly
 * marked answered. A `completed` call with none of those is re-mapped to:
 *   - "no-answer"  for outbound calls
 *   - "missed"     for incoming calls
 *
 * Explicit non-answered Exotel statuses (no-answer/busy/failed/canceled) are
 * always honoured regardless of direction.
 */

export type CallDirection = "incoming" | "outbound";

/**
 * Best-effort call direction from the stored numbers. Outbound when the call
 * originates from one of our virtual/Exotel lines; otherwise incoming. Mirrors
 * the read-time derivation in /api/calls so stored statuses are labelled
 * consistently with what the list shows.
 */
export function deriveCallDirection(
  fromNumber: string | null | undefined,
  virtualNumbers: string[],
  phoneMatches: (a: string, b: string) => boolean
): CallDirection {
  const from = fromNumber ?? "";
  const fromIsVirtual = virtualNumbers.some((v) => v && phoneMatches(v, from));
  return fromIsVirtual ? "outbound" : "incoming";
}

const BASE_STATUS_MAP: Record<string, string> = {
  // DialCallStatus / Status values
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  "no answer": "no-answer",
  failed: "failed",
  canceled: "failed",
  cancelled: "failed",
  // CallType fallbacks (used when DialCallStatus is absent). None of these on
  // their own prove the dialled party answered — they're resolved against the
  // answered signals below.
  incomplete: "no-answer",
  "client-hangup": "completed", // only stays "completed" if actually answered
  voicemail: "completed", // only stays "completed" if actually answered
};

/** Shape of the fields we read off an Exotel Call object (any source). */
export type ExotelStatusInput = {
  /** Exotel top-level Status. */
  status?: string | null;
  /** Total call duration in seconds (includes ring time). */
  duration?: number | string | null;
  /** Talk time in seconds, if Exotel provides it (ConversationDuration). */
  conversationDuration?: number | string | null;
  /** Recording duration in seconds, if available. */
  recordingDuration?: number | string | null;
  /** Whether a recording URL is present (a recording ⇒ the call was answered). */
  hasRecording?: boolean;
  /** Per-leg dial status, when Exotel exposes it (DialCallStatus / Legs[].Status). */
  legStatus?: string | null;
};

function toInt(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** True when the Exotel data shows the call was actually picked up. */
export function wasCallAnswered(input: ExotelStatusInput): boolean {
  if (input.hasRecording) return true;
  if (toInt(input.recordingDuration) > 0) return true;
  if (toInt(input.conversationDuration) > 0) return true;
  const leg = (input.legStatus ?? "").toLowerCase();
  if (leg === "completed" || leg === "answered" || leg === "in-progress") return true;
  return false;
}

/**
 * Resolve the stored status from raw Exotel data + the call's direction.
 * Pass the direction so an unanswered call is labelled correctly
 * (missed for incoming, no-answer for outbound).
 */
export function resolveCallStatus(
  input: ExotelStatusInput,
  direction: CallDirection
): string {
  const raw = (input.status ?? "").toLowerCase().trim();
  const mapped = BASE_STATUS_MAP[raw] ?? raw;
  const unanswered = direction === "incoming" ? "missed" : "no-answer";

  // Honour explicit non-answered statuses straight away.
  if (mapped === "busy" || mapped === "failed") return mapped;
  if (mapped === "no-answer") return unanswered;

  // A call is only "completed" when we have proof the dialled party answered
  // (recording, real talk time, or an answered leg). This is the crux: Exotel
  // reports "completed"/"client-hangup"/"voicemail" even when nobody picked up.
  if (mapped === "completed") {
    return wasCallAnswered(input) ? "completed" : unanswered;
  }

  // Unknown/unmapped status: trust it only if answered, else treat as missed.
  return wasCallAnswered(input) ? "completed" : unanswered;
}
