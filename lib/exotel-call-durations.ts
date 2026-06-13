/** Parse duration fields from Exotel v1 Call JSON (GET + StatusCallback shapes). */

export type ExotelCallLike = {
  Duration?: string | number | null;
  ConversationDuration?: string | number | null;
  RecordingDuration?: string | number | null;
  Details?: {
    ConversationDuration?: string | number | null;
    Legs?: Array<
      | { Leg?: { OnCallDuration?: string | number | null } }
      | { OnCallDuration?: string | number | null }
    >;
  } | null;
};

export function parseExotelSeconds(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Exotel dashboard "Total Talk Time" — top-level or nested under Details. */
export function exotelConversationSeconds(call: ExotelCallLike): number | null {
  const top = parseExotelSeconds(call.ConversationDuration);
  if (top) return top;
  const nested = parseExotelSeconds(call.Details?.ConversationDuration);
  if (nested) return nested;
  return null;
}

export function exotelTotalSeconds(call: ExotelCallLike): number | null {
  return parseExotelSeconds(call.Duration);
}

export function exotelRecordingSeconds(call: ExotelCallLike): number | null {
  return parseExotelSeconds(call.RecordingDuration);
}
