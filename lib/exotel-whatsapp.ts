import "server-only";

import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";
import { normalizePhone } from "@/lib/phone";

export function isExotelWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.EXOTEL_SID?.trim() &&
      process.env.EXOTEL_API_KEY?.trim() &&
      process.env.EXOTEL_API_TOKEN?.trim()
  );
}

export function getExotelAccountSid(): string {
  return process.env.EXOTEL_SID?.trim() ?? "";
}

/** Mumbai default; Singapore uses api.exotel.com — set EXOTEL_API_HOST if needed. */
export function getExotelApiHost(): string {
  return process.env.EXOTEL_API_HOST?.trim() || "api.in.exotel.com";
}

export function getExotelV2MessagesUrl(): string | null {
  const sid = process.env.EXOTEL_SID?.trim();
  const apiKey = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;
  const host = getExotelApiHost();
  return `https://${encodeURIComponent(apiKey)}:${encodeURIComponent(apiToken)}@${host}/v2/accounts/${sid}/messages`;
}

export function getExotelWhatsAppWebhookUrl(): string | null {
  const base = getTwilioWebhookBaseUrl();
  return base ? `${base.replace(/\/+$/, "")}/api/exotel/whatsapp` : null;
}

type ExotelMessageContent = {
  recipient_type: "individual";
  type: "text";
  text: { preview_url: boolean; body: string };
};

export async function sendExotelWhatsAppText(params: {
  fromE164: string;
  toE164: string;
  body: string;
  statusCallback?: string | null;
}): Promise<{ sid: string }> {
  const url = getExotelV2MessagesUrl();
  if (!url) {
    throw new Error(
      "Exotel WhatsApp is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN."
    );
  }

  const from = normalizePhone(params.fromE164);
  const to = normalizePhone(params.toE164);
  const statusCallback = params.statusCallback ?? getExotelWhatsAppWebhookUrl();

  const payload = {
    whatsapp: {
      messages: [
        {
          from,
          to,
          ...(statusCallback ? { status_callback: statusCallback } : {}),
          content: {
            recipient_type: "individual",
            type: "text",
            text: { preview_url: false, body: params.body },
          } satisfies ExotelMessageContent,
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    response?: {
      whatsapp?: {
        messages?: Array<{ data?: { sid?: string }; sid?: string; status?: string; message?: string }>;
      };
    };
  };

  if (!res.ok) {
    const msg =
      json.message ||
      json.error ||
      json.response?.whatsapp?.messages?.[0]?.message ||
      `Exotel WhatsApp send failed (${res.status})`;
    throw new Error(msg);
  }

  const first = json.response?.whatsapp?.messages?.[0];
  const sid = first?.data?.sid ?? first?.sid;
  if (!sid) {
    throw new Error("Exotel accepted the message but returned no message sid.");
  }
  return { sid };
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
    case "interactive": {
      const interactive = message.interactive as Record<string, unknown> | undefined;
      const btn = interactive?.button_reply as { title?: string } | undefined;
      const list = interactive?.list_reply as { title?: string } | undefined;
      return { body: btn?.title || list?.title || "[Interactive reply]", numMedia: 0 };
    }
    default:
      return { body: type ? `[${type}]` : "", numMedia: 0 };
  }
}
