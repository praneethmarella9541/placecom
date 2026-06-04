import "server-only";

import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";
import {
  getExotelApiHost,
  getExotelApiHostCandidates,
  getExotelBasicAuthHeader,
  getExotelCredentials,
  getExotelV2MessagesUrl,
  parseExotelErrorBody,
} from "@/lib/exotel-config";
import { normalizePhone } from "@/lib/phone";

export function isExotelWhatsAppConfigured(): boolean {
  return Boolean(getExotelCredentials());
}

export function getExotelAccountSid(): string {
  return getExotelCredentials()?.sid ?? "";
}

export { getExotelApiHost };

function extractMessageSidFromSendResponse(json: Record<string, unknown>): string | undefined {
  const response = json.response;
  if (!response || typeof response !== "object") return undefined;
  const whatsapp = (response as Record<string, unknown>).whatsapp;
  if (!whatsapp || typeof whatsapp !== "object") return undefined;
  const messages = (whatsapp as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const first = messages[0];
  if (!first || typeof first !== "object") return undefined;
  const row = first as Record<string, unknown>;
  if (typeof row.sid === "string") return row.sid;
  const data = row.data;
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).sid === "string") {
    return (data as Record<string, unknown>).sid as string;
  }
  return undefined;
}

export function getExotelWhatsAppWebhookUrl(): string | null {
  const base = getTwilioWebhookBaseUrl();
  return base ? `${base.replace(/\/+$/, "")}/api/exotel/whatsapp` : null;
}

async function postExotelWhatsAppPayload(
  payload: Record<string, unknown>
): Promise<{ sid: string }> {
  const creds = getExotelCredentials();
  if (!creds) {
    throw new Error(
      "Exotel WhatsApp is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN."
    );
  }

  const authorization = getExotelBasicAuthHeader(creds);
  const hosts = getExotelApiHostCandidates();
  let lastError = "Exotel WhatsApp send failed";
  let lastStatus = 0;

  for (const host of hosts) {
    const url = getExotelV2MessagesUrl(host, creds.sid);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(payload),
    });

    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    if (res.ok) {
      const sid = extractMessageSidFromSendResponse(json);
      if (!sid) {
        throw new Error("Exotel accepted the message but returned no message sid.");
      }
      return { sid };
    }

    lastStatus = res.status;
    lastError = parseExotelErrorBody(json, res.status);
    if (res.status !== 401 || hosts.length === 1) {
      break;
    }
  }

  throw new Error(lastError || `Exotel WhatsApp send failed (${lastStatus})`);
}

export type ExotelWhatsAppRecipientType = "individual" | "group";

function buildMessageEnvelope(
  from: string,
  to: string,
  content: Record<string, unknown>,
  statusCallback: string | null | undefined,
  recipientType: ExotelWhatsAppRecipientType = "individual"
) {
  return {
    whatsapp: {
      messages: [
        {
          from,
          to,
          ...(statusCallback ? { status_callback: statusCallback } : {}),
          content: {
            recipient_type: recipientType,
            ...content,
          },
        },
      ],
    },
  };
}

/** Session message (text, media, location, interactive) — requires open 24h window. */
export async function sendExotelWhatsAppSession(params: {
  fromE164: string;
  to: string;
  content: Record<string, unknown>;
  recipientType?: ExotelWhatsAppRecipientType;
  statusCallback?: string | null;
}): Promise<{ sid: string }> {
  const from = normalizePhone(params.fromE164);
  const to =
    params.recipientType === "group" ? params.to.trim() : normalizePhone(params.to);
  const statusCallback = params.statusCallback ?? getExotelWhatsAppWebhookUrl();
  return postExotelWhatsAppPayload(
    buildMessageEnvelope(from, to, params.content, statusCallback, params.recipientType ?? "individual")
  );
}

/** Session (free-form) text — only delivered if the recipient messaged you within the last 24 hours. */
export async function sendExotelWhatsAppText(params: {
  fromE164: string;
  toE164: string;
  body: string;
  statusCallback?: string | null;
}): Promise<{ sid: string }> {
  return sendExotelWhatsAppSession({
    fromE164: params.fromE164,
    to: params.toE164,
    content: { type: "text", text: { preview_url: false, body: params.body } },
    statusCallback: params.statusCallback,
  });
}

/** Approved template — required to start a chat or message outside the 24h session window. */
export async function sendExotelWhatsAppTemplate(params: {
  fromE164: string;
  toE164: string;
  templateName: string;
  languageCode: string;
  bodyVariables: string[];
  statusCallback?: string | null;
}): Promise<{ sid: string }> {
  const from = normalizePhone(params.fromE164);
  const to = normalizePhone(params.toE164);
  const statusCallback = params.statusCallback ?? getExotelWhatsAppWebhookUrl();
  const parameters = params.bodyVariables.map((text) => ({ type: "text" as const, text }));
  return postExotelWhatsAppPayload(
    buildMessageEnvelope(
      from,
      to,
      {
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode, policy: "deterministic" },
          components: [{ type: "body", parameters }],
        },
      },
      statusCallback
    )
  );
}

/** Extract display text from Exotel inbound_message payload. */
export function extractExotelInboundBody(message: Record<string, unknown> | undefined): {
  body: string;
  numMedia: number;
} {
  if (!message || typeof message !== "object") {
    return { body: "", numMedia: 0 };
  }

  const type = String(message.type ?? "");
  switch (type) {
    case "text": {
      const text = message.text as { body?: string } | undefined;
      return { body: text?.body?.trim() ?? "", numMedia: 0 };
    }
    case "image": {
      const image = message.image as { caption?: string } | undefined;
      return { body: image?.caption?.trim() || "[Image]", numMedia: 1 };
    }
    case "video": {
      const video = message.video as { caption?: string } | undefined;
      return { body: video?.caption?.trim() || "[Video]", numMedia: 1 };
    }
    case "document":
      return { body: "[Document]", numMedia: 1 };
    case "audio":
      return { body: "[Audio]", numMedia: 1 };
    case "sticker":
      return { body: "[Sticker]", numMedia: 0 };
    case "location":
      return { body: "[Location]", numMedia: 0 };
    case "button": {
      const button = message.button as { text?: string } | undefined;
      return { body: button?.text?.trim() || "[Button reply]", numMedia: 0 };
    }
    case "interactive": {
      const interactive = message.interactive as Record<string, unknown> | undefined;
      const btn = interactive?.button_reply as { title?: string } | undefined;
      const list = interactive?.list_reply as { title?: string } | undefined;
      const nfm = interactive?.nfm_reply as { body?: string } | undefined;
      return {
        body: btn?.title || list?.title || nfm?.body || "[Interactive reply]",
        numMedia: 0,
      };
    }
    default:
      return { body: type ? `[${type}]` : "", numMedia: 0 };
  }
}
