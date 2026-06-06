import "server-only";

import { getWebhookBaseUrl } from "@/lib/call-recording-url";
import {
  getExotelApiHost,
  getExotelApiHostCandidates,
  getExotelBasicAuthHeader,
  getExotelCredentials,
  parseExotelErrorBody,
} from "@/lib/exotel-config";
import { normalizePhone } from "@/lib/phone";

export { getExotelApiHost };

/** SMS send is available whenever the shared Exotel API credentials are set. */
export function isExotelSmsConfigured(): boolean {
  return Boolean(getExotelCredentials());
}

/** v1 single-SMS endpoint: https://{host}/v1/Accounts/{sid}/Sms/send.json */
function getExotelSmsSendUrl(host: string, sid: string): string {
  const h = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${h}/v1/Accounts/${sid}/Sms/send.json`;
}

/** Status callback (DLR) URL Exotel posts terminal SMS states to. */
export function getExotelSmsStatusCallbackUrl(): string | null {
  const base = getWebhookBaseUrl();
  return base ? `${base.replace(/\/+$/, "")}/api/exotel/sms/status` : null;
}

type ExotelSmsResult = { sid: string; status: string };

function extractSmsResult(json: Record<string, unknown>): ExotelSmsResult | null {
  // v1 response shape: { SMSMessage: { Sid, Status, ... } }
  const msg =
    (json.SMSMessage as Record<string, unknown> | undefined) ??
    (json.SMSMessages as Record<string, unknown> | undefined);
  if (msg && typeof msg === "object") {
    const sid = msg.Sid ?? msg.sid;
    if (typeof sid === "string" && sid) {
      const status = msg.Status ?? msg.status;
      return { sid, status: typeof status === "string" ? status : "queued" };
    }
  }
  return null;
}

/**
 * Send a single outbound SMS through Exotel.
 *
 * @param from  The ExoPhone / sender id assigned to the user (E.164 or sender id).
 * @param to    Recipient in E.164.
 * @param body  Message text (max 2000 chars per Exotel).
 *
 * @see https://developer.exotel.com/api/sms — POST {host}/v1/Accounts/{sid}/Sms/send
 *      Body is form-urlencoded; auth is HTTP Basic (api_key:api_token).
 */
export async function sendExotelSms(params: {
  from: string;
  to: string;
  body: string;
  statusCallback?: string | null;
}): Promise<ExotelSmsResult> {
  const creds = getExotelCredentials();
  if (!creds) {
    throw new Error(
      "Exotel SMS is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN."
    );
  }

  const from = normalizePhone(params.from) || params.from.trim();
  const to = normalizePhone(params.to);
  const statusCallback = params.statusCallback ?? getExotelSmsStatusCallbackUrl();

  const form = new URLSearchParams();
  form.set("From", from);
  form.set("To", to);
  form.set("Body", params.body);
  // Transactional keeps OTP/notification-style messages off the promotional DND rules.
  form.set("SmsType", process.env.EXOTEL_SMS_TYPE?.trim() || "transactional");
  if (statusCallback) form.set("StatusCallback", statusCallback);

  const authorization = getExotelBasicAuthHeader(creds);
  const hosts = getExotelApiHostCandidates();
  let lastError = "Exotel SMS send failed";
  let lastStatus = 0;

  for (const host of hosts) {
    const url = getExotelSmsSendUrl(host, creds.sid);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authorization,
      },
      body: form.toString(),
    });

    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    if (res.ok) {
      const result = extractSmsResult(json);
      if (!result) {
        throw new Error("Exotel accepted the SMS but returned no message sid.");
      }
      return result;
    }

    lastStatus = res.status;
    lastError = parseExotelErrorBody(json, res.status);
    // 401 usually means wrong region — fall through to the next host candidate.
    if (res.status !== 401 || hosts.length === 1) break;
  }

  throw new Error(lastError || `Exotel SMS send failed (${lastStatus})`);
}
