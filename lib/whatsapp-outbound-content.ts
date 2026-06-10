import "server-only";

import {
  sendExotelWhatsAppSession,
  sendExotelWhatsAppTemplate,
} from "@/lib/exotel-whatsapp";

export type OutboundSendInput = {
  fromE164: string;
  toE164: string;
  messageType: string;
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFilename?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactiveBody?: string;
  interactiveButtons?: Array<{ id: string; title: string }>;
};

export type OutboundSendResult = {
  sid: string;
  logBody: string;
  contentType: string;
  numMedia: number;
  mediaUrl: string | null;
};

export async function dispatchExotelWhatsAppOutbound(input: OutboundSendInput): Promise<OutboundSendResult> {
  const type = input.messageType.trim().toLowerCase();

  if (type === "template") {
    const vars = input.templateVariables ?? [];
    const { sid } = await sendExotelWhatsAppTemplate({
      fromE164: input.fromE164,
      toE164: input.toE164,
      templateName: input.templateName ?? "initial_conversation",
      languageCode: input.templateLanguage ?? "en",
      bodyVariables: vars,
    });
    return {
      sid,
      logBody: `[Template: ${input.templateName}] ${vars.join(" · ")}`,
      contentType: "template",
      numMedia: 0,
      mediaUrl: null,
    };
  }

  if (type === "text") {
    const body = input.text?.trim() ?? "";
    if (!body) throw new Error("Message text is required.");
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: { type: "text", text: { preview_url: false, body } },
    });
    return { sid, logBody: body, contentType: "text", numMedia: 0, mediaUrl: null };
  }

  const link = input.mediaUrl?.trim();
  if (!link?.startsWith("https://")) {
    throw new Error("Media messages require an HTTPS URL (upload the file first).");
  }

  console.log("[whatsapp/outbound] media send:", { type, link: link.slice(0, 120), filename: input.mediaFilename });

  if (type === "image") {
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: {
        type: "image",
        image: { link, ...(input.mediaCaption ? { caption: input.mediaCaption.slice(0, 1024) } : {}) },
      },
    });
    return {
      sid,
      logBody: input.mediaCaption?.trim() || "[Image]",
      contentType: "image",
      numMedia: 1,
      mediaUrl: link,
    };
  }

  if (type === "video") {
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: {
        type: "video",
        video: { link, ...(input.mediaCaption ? { caption: input.mediaCaption.slice(0, 1024) } : {}) },
      },
    });
    return {
      sid,
      logBody: input.mediaCaption?.trim() || "[Video]",
      contentType: "video",
      numMedia: 1,
      mediaUrl: link,
    };
  }

  if (type === "audio") {
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: { type: "audio", audio: { link } },
    });
    return { sid, logBody: "[Audio]", contentType: "audio", numMedia: 1, mediaUrl: link };
  }

  if (type === "document") {
    const filename = input.mediaFilename?.trim() || "document";
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: {
        type: "document",
        document: {
          link,
          filename: filename.slice(0, 240),
          ...(input.mediaCaption ? { caption: input.mediaCaption.slice(0, 1024) } : {}),
        },
      },
    });
    return {
      sid,
      logBody: input.mediaCaption?.trim() || `[Document: ${filename}]`,
      contentType: "document",
      numMedia: 1,
      mediaUrl: link,
    };
  }

  if (type === "location") {
    const loc = input.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      throw new Error("Location requires latitude and longitude.");
    }
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: {
        type: "location",
        location: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.name ? { name: loc.name.slice(0, 200) } : {}),
          ...(loc.address ? { address: loc.address.slice(0, 200) } : {}),
        },
      },
    });
    const label = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
    return { sid, logBody: `[Location] ${label}`, contentType: "location", numMedia: 0, mediaUrl: null };
  }

  if (type === "interactive") {
    const body = input.interactiveBody?.trim();
    const buttons = (input.interactiveButtons ?? []).filter((b) => b.id && b.title).slice(0, 3);
    if (!body) throw new Error("Interactive message needs body text.");
    if (buttons.length === 0) throw new Error("Add at least one button (max 3).");
    const { sid } = await sendExotelWhatsAppSession({
      fromE164: input.fromE164,
      to: input.toE164,
      content: {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body.slice(0, 1024) },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
            })),
          },
        },
      },
    });
    return {
      sid,
      logBody: `${body} [Buttons: ${buttons.map((b) => b.title).join(", ")}]`,
      contentType: "interactive",
      numMedia: 0,
      mediaUrl: null,
    };
  }

  throw new Error(
    `Unsupported messageType "${type}". Use text, template, image, video, audio, document, location, or interactive.`
  );
}
