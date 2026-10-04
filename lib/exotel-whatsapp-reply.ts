import "server-only";

import {
  getExotelApiHostCandidates,
  getExotelBasicAuthHeader,
  getExotelCredentials,
} from "@/lib/exotel-config";

/** Exotel puts reply context inside `content.context` using `sid` (see inbound webhooks). */
export function buildExotelReplyContext(
  quoteMessageId: string | null | undefined
): { sid: string } | null {
  const id = quoteMessageId?.trim();
  if (!id) return null;
  return { sid: id };
}

function extractQuoteIdFromExotelRecord(json: Record<string, unknown>): string | null {
  function dig(obj: unknown, depth = 0): string | null {
    if (!obj || typeof obj !== "object" || depth > 8) return null;
    const o = obj as Record<string, unknown>;

    for (const key of ["sid", "message_sid", "id"]) {
      const v = String(o[key] ?? "").trim();
      if (v.length >= 8) return v;
    }

    for (const val of Object.values(o)) {
      if (val && typeof val === "object") {
        const hit = dig(val, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }
  return dig(json);
}

/** Resolve the Exotel sid to quote — falls back to the stored value if lookup fails. */
export async function resolveExotelQuoteMessageId(storedSid: string): Promise<string> {
  const trimmed = storedSid.trim();
  if (!trimmed) return trimmed;

  const creds = getExotelCredentials();
  if (!creds) return trimmed;

  const auth = getExotelBasicAuthHeader(creds);
  for (const host of getExotelApiHostCandidates()) {
    const h = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const url = `https://${h}/v2/accounts/${creds.sid}/messages/${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const resolved = extractQuoteIdFromExotelRecord(json);
      if (resolved) return resolved;
    } catch (e) {
      console.warn("[whatsapp/reply] GET message lookup failed:", trimmed, e);
    }
  }

  return trimmed;
}
