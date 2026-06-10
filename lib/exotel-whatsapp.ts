import "server-only";

import { getWebhookBaseUrl } from "@/lib/call-recording-url";
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
  const base = getWebhookBaseUrl();
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
type MediaBlock = {
  id?: string;
  link?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
};

export type ExtractedBody = {
  body: string;
  numMedia: number;
  /** Exotel/Meta media object id — used to construct the proxy download URL. */
  mediaId: string | null;
  /** Direct CDN link when Exotel provides one (less common for inbound). */
  mediaLink: string | null;
  contentType: string | null;
};

export function extractExotelInboundBody(message: Record<string, unknown> | undefined): ExtractedBody {
  const none: ExtractedBody = { body: "", numMedia: 0, mediaId: null, mediaLink: null, contentType: null };
  if (!message || typeof message !== "object") return none;

  function pickMedia(block: MediaBlock | undefined): Pick<ExtractedBody, "mediaId" | "mediaLink" | "contentType"> {
    return {
      mediaId: block?.id?.trim() || null,
      mediaLink: block?.link?.trim() || null,
      contentType: block?.mime_type?.trim() || null,
    };
  }

  const type = String(message.type ?? "");
  switch (type) {
    case "text": {
      const text = message.text as { body?: string } | undefined;
      return { ...none, body: text?.body?.trim() ?? "" };
    }
    case "image": {
      const image = message.image as MediaBlock | undefined;
      return {
        body: image?.caption?.trim() || "[Image]",
        numMedia: 1,
        ...pickMedia(image),
        contentType: image?.mime_type?.trim() || "image/jpeg",
      };
    }
    case "video": {
      const video = message.video as MediaBlock | undefined;
      return {
        body: video?.caption?.trim() || "[Video]",
        numMedia: 1,
        ...pickMedia(video),
        contentType: video?.mime_type?.trim() || "video/mp4",
      };
    }
    case "document": {
      const doc = message.document as MediaBlock | undefined;
      return {
        body: doc?.filename?.trim() || "[Document]",
        numMedia: 1,
        ...pickMedia(doc),
        contentType: doc?.mime_type?.trim() || "application/octet-stream",
      };
    }
    case "audio": {
      const audio = message.audio as MediaBlock | undefined;
      return {
        body: "[Audio]",
        numMedia: 1,
        ...pickMedia(audio),
        contentType: audio?.mime_type?.trim() || "audio/ogg",
      };
    }
    case "sticker": {
      const sticker = message.sticker as MediaBlock | undefined;
      return {
        body: "[Sticker]",
        numMedia: 1,
        ...pickMedia(sticker),
        contentType: sticker?.mime_type?.trim() || "image/webp",
      };
    }
    case "reaction": {
      const reaction = message.reaction as { emoji?: string } | undefined;
      return { ...none, body: reaction?.emoji?.trim() || "❤️" };
    }
    case "location":
      return { ...none, body: "[Location]" };
    case "button": {
      const button = message.button as { text?: string } | undefined;
      return { ...none, body: button?.text?.trim() || "[Button reply]" };
    }
    case "interactive": {
      const interactive = message.interactive as Record<string, unknown> | undefined;
      const btn = interactive?.button_reply as { title?: string } | undefined;
      const list = interactive?.list_reply as { title?: string } | undefined;
      const nfm = interactive?.nfm_reply as { body?: string } | undefined;
      return { ...none, body: btn?.title || list?.title || nfm?.body || "[Interactive reply]" };
    }
    default:
      return { ...none, body: type ? `[${type}]` : "" };
  }
}
