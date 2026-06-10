import "server-only";

import { extractExotelInboundBody } from "@/lib/exotel-whatsapp";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";
import { createServiceSupabase } from "@/lib/supabase-service";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export type ParsedInbound = {
  messageSid: string;
  fromRaw: string;
  toRaw: string;
  peerE164: string;
  businessE164: string;
  displayBody: string;
  numMedia: number;
};

export type ParsedStatus = {
  messageSid: string;
  status: string;
  /** Human-readable failure reason when status is failed. */
  errorDetail?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

/** Match Exotel `to` field to a full E.164 business line from env + profiles. */
export async function resolveBusinessE164FromWebhook(toRaw: string): Promise<string | null> {
  const trimmed = toRaw.trim();
  if (!trimmed) return null;

  const direct = normalizePhone(trimmed);
  if (direct.startsWith("+")) {
    if (await lineExists(direct)) return direct;
  }

  const candidates = [
    ...(await getExotelVirtualNumbers()),
    ...(await listProfileExotelLines()),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  for (const line of candidates) {
    if (phoneMatches(line, trimmed) || phoneMatches(line, direct)) {
      return line;
    }
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8) {
    for (const line of candidates) {
      const lineDigits = line.replace(/\D/g, "");
      if (lineDigits.endsWith(digits) || digits.endsWith(lineDigits.slice(-10))) {
        return line;
      }
    }
  }

  return direct.startsWith("+") ? direct : null;
}

async function lineExists(line: string): Promise<boolean> {
  const configured = await getExotelVirtualNumbers();
  if (configured.some((n) => phoneMatches(n, line))) return true;
  const profiles = await listProfileExotelLines();
  return profiles.some((n) => phoneMatches(n, line));
}

async function listProfileExotelLines(): Promise<string[]> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from("profiles")
      .select("exotel_virtual_number")
      .not("exotel_virtual_number", "is", null);
    return (data ?? [])
      .map((r) => normalizePhone((r.exotel_virtual_number as string) ?? ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseInboundFromDataBlock(
  block: Record<string, unknown>,
  defaults?: { toFallback?: string }
): ParsedInbound | null {
  const messageSid = pickString(block.message_sid, block.id, block.sid);
  const fromRaw = pickString(block.from);
  let toRaw = pickString(block.to);
  if (!toRaw && defaults?.toFallback) toRaw = defaults.toFallback;

  const content = asRecord(block.message) ?? asRecord(block.content) ?? block;
  const { body, numMedia } = extractExotelInboundBody(content);

  if (!messageSid || !fromRaw) return null;

  return {
    messageSid,
    fromRaw,
    toRaw,
    peerE164: safePeerE164(fromRaw),
    businessE164: "",
    displayBody: body || (numMedia > 0 ? `[${numMedia} attachment(s)]` : ""),
    numMedia,
  };
}

function safePeerE164(fromRaw: string): string {
  const peer = normalizePeerE164(fromRaw);
  if (peer.startsWith("+")) return peer;
  const n = normalizePhone(fromRaw);
  return n.startsWith("+") ? n : `+${fromRaw.replace(/\D/g, "")}`;
}

/**
 * Exotel uses multiple webhook shapes (Cloud API vs older docs).
 * @see https://developer.exotel.com/docs/whatsapp-api/api-reference/receive-messages
 */
export function parseExotelInboundWebhook(body: Record<string, unknown>): ParsedInbound | null {
  // Shape A (Receive Messages API): { event: "incoming_message", message: { id, from, to, type, text } }
  if (body.event === "incoming_message" || body.type === "incoming_message") {
    const msg = asRecord(body.message);
    const data = asRecord(body.data);
    const block = msg ?? data;
    if (block) {
      const ctx = asRecord(block.context);
      const parsed = parseInboundFromDataBlock(block, {
        toFallback: pickString(ctx?.from, body.to),
      });
      if (parsed) return parsed;
    }
  }

  // Shape B (whatsapp-support docs): { type: "inbound_message", data: { message_sid, from, to, message } }
  const data = asRecord(body.data);
  if (data) {
    const parsed = parseInboundFromDataBlock(data);
    if (parsed) return parsed;
  }

  // Shape C (Cloud migration): { whatsapp: { messages: [{ callback_type: "incoming_message", ... }] } }
  const wa = asRecord(body.whatsapp);
  const list = (wa?.messages ?? body.messages) as unknown;
  if (Array.isArray(list)) {
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      const cb = String(row.callback_type ?? row.type ?? "").toLowerCase();
      if (cb && cb !== "incoming_message" && cb !== "inbound_message") continue;
      const parsed = parseInboundFromDataBlock(row);
      if (parsed) return parsed;
    }
  }

  // Shape D: Meta-style nested contacts/messages (on-premise legacy)
  const messages = (body.messages ?? asRecord(body.contacts)?.messages) as unknown;
  if (Array.isArray(messages) && messages[0]) {
    const row = asRecord(messages[0]);
    if (row) {
      const parsed = parseInboundFromDataBlock({
        message_sid: row.id,
        from: row.from,
        to: body.to,
        message: row,
      });
      if (parsed) return parsed;
    }
  }

  return null;
}

function mapExoDetailedStatus(exo: string, description: string): ParsedStatus | null {
  const code = exo.trim().toUpperCase();
  if (!code) return null;
  if (code === "EX_MESSAGE_DELIVERED") {
    return { messageSid: "", status: "delivered" };
  }
  if (code === "EX_MESSAGE_SEEN") {
    return { messageSid: "", status: "read" };
  }
  if (code === "EX_MESSAGE_SENT") {
    return { messageSid: "", status: "sent" };
  }
  if (code.startsWith("EX_")) {
    return {
      messageSid: "",
      status: "failed",
      errorDetail: description || code.replace(/_/g, " ").toLowerCase(),
    };
  }
  return null;
}

function parseStatusErrors(block: Record<string, unknown>): string | undefined {
  const errors = block.errors;
  if (!Array.isArray(errors) || !errors[0] || typeof errors[0] !== "object") return undefined;
  const err = errors[0] as Record<string, unknown>;
  return pickString(err.detail, err.title, err.message, err.code ? String(err.code) : "");
}

/** Map Exotel/Meta status webhooks and DLR callbacks to a DB delivery_status value. */
export function formatDeliveryStatusForDb(status: ParsedStatus): string {
  if (status.status === "failed" && status.errorDetail) {
    return `failed: ${status.errorDetail.slice(0, 240)}`;
  }
  return status.status;
}

export function parseExotelStatusWebhook(body: Record<string, unknown>): ParsedStatus | null {
  // Shape A (v2 send API DLR): { whatsapp: { messages: [{ callback_type: "dlr", sid, exo_detailed_status }] } }
  const wa = asRecord(body.whatsapp);
  const dlrList = (wa?.messages ?? body.messages) as unknown;
  if (Array.isArray(dlrList)) {
    for (const item of dlrList) {
      const row = asRecord(item);
      if (!row) continue;
      const cb = String(row.callback_type ?? row.type ?? "").toLowerCase();
      if (cb && cb !== "dlr" && cb !== "message_status") continue;
      const messageSid = pickString(row.sid, row.message_sid, row.id);
      const exo = pickString(row.exo_detailed_status);
      const description = pickString(row.description);
      if (exo) {
        const mapped = mapExoDetailedStatus(exo, description);
        if (mapped && messageSid) {
          return { ...mapped, messageSid };
        }
      }
      const status = pickString(row.status);
      if (messageSid && status) {
        return {
          messageSid,
          status,
          errorDetail: status === "failed" ? description || parseStatusErrors(row) : undefined,
        };
      }
    }
  }

  // Shape B/C: { type|event: "message_status", data|message: { message_sid|id, status, errors? } }
  if (body.type === "message_status" || body.event === "message_status") {
    const data = asRecord(body.data);
    const msg = asRecord(body.message);
    const block = data ?? msg;
    if (!block) return null;
    const messageSid = pickString(block.message_sid, block.id);
    const status = pickString(block.status);
    if (messageSid && status) {
      return {
        messageSid,
        status,
        errorDetail: status === "failed" ? parseStatusErrors(block) : undefined,
      };
    }
  }
  return null;
}

export async function finalizeInbound(parsed: ParsedInbound): Promise<ParsedInbound | null> {
  const businessE164 = await resolveBusinessE164FromWebhook(parsed.toRaw);
  if (!businessE164) {
    console.warn(
      "[exotel/whatsapp] could not resolve business line for to:",
      parsed.toRaw,
      "| from:",
      parsed.fromRaw
    );
    return null;
  }
  return { ...parsed, businessE164 };
}
