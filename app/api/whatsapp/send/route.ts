import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isExotelWhatsAppConfigured } from "@/lib/exotel-whatsapp";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { hasOpenWhatsAppSessionForPeer } from "@/lib/whatsapp-session";
import { formatTemplatePreview } from "@/lib/whatsapp-template";
import { resolveWhatsAppTemplateAsync } from "@/lib/whatsapp-template-resolve";
import { resolveExotelQuoteMessageId } from "@/lib/exotel-whatsapp-reply";
import { dispatchExotelWhatsAppOutbound } from "@/lib/whatsapp-outbound-content";
import { resolveOutboundMediaUrl } from "@/lib/whatsapp-outbound-media-url";
import { createServiceSupabase } from "@/lib/supabase-service";
import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";
import { isValidE164, normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isExotelWhatsAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Exotel WhatsApp is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN on the server.",
      },
      { status: 503 }
    );
  }

  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }
  const businessLine = lineResult.data.line;

  const body = (await request.json().catch(() => null)) as {
    to?: string;
    messageType?: string;
    text?: string;
    replyToId?: string;
    useTemplate?: boolean;
    templateName?: string;
    templateLanguage?: string;
    templateVariables?: string[];
    mediaUrl?: string;
    mediaCaption?: string;
    mediaFilename?: string;
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
    interactiveBody?: string;
    interactiveButtons?: Array<{ id?: string; title?: string }>;
  } | null;

  const to = body?.to?.trim() || "";
  const replyToIdRaw = body?.replyToId?.trim() || "";
  const forceTemplate = body?.useTemplate === true;
  const forceSession = body?.useTemplate === false;

  if (!isValidE164(normalizePhone(to))) {
    return NextResponse.json(
      { error: "Provide recipient in E.164 format, e.g. +919876543210" },
      { status: 400 }
    );
  }

  const peerNorm = canonicalWhatsAppPeer(to);
  const sessionOpen = await hasOpenWhatsAppSessionForPeer(supabase, peerNorm, businessLine);
  const mustUseTemplate = forceTemplate || (!forceSession && !sessionOpen);

  const messageTypeRaw = body?.messageType?.trim().toLowerCase() || (mustUseTemplate ? "template" : "text");

  if (mustUseTemplate && messageTypeRaw !== "template") {
    return NextResponse.json(
      {
        error:
          "Attachments and rich messages require an open session (customer must reply within 24 hours). Use template to open the chat, or wait for their reply.",
      },
      { status: 400 }
    );
  }

  const templateConfig = await resolveWhatsAppTemplateAsync(body?.templateName);
  const templateName = templateConfig.name;
  const templateLanguage = templateConfig.languageCode;

  let templateVariables = Array.isArray(body?.templateVariables)
    ? body.templateVariables.map((v) => String(v).trim()).filter(Boolean)
    : [];

  if (messageTypeRaw === "template" || mustUseTemplate) {
    if (templateVariables.length < templateConfig.bodyParamCount) {
      return NextResponse.json(
        {
          error: `First message must use template "${templateName}". Provide templateVariables with ${templateConfig.bodyParamCount} value(s).`,
        },
        { status: 400 }
      );
    }
    templateVariables = templateVariables.slice(0, templateConfig.bodyParamCount);
    const missing = templateVariables.findIndex((v) => !v);
    if (missing >= 0) {
      return NextResponse.json(
        { error: `Template variable ${missing + 1} is required.` },
        { status: 400 }
      );
    }
  }

  let replyToId: string | null = null;
  let replyToMessageId: string | null = null;
  if (replyToIdRaw) {
    const { data: ref, error: refErr } = await supabase
      .from("whatsapp_messages")
      .select("id, peer_e164, business_e164, deleted_at, message_sid")
      .eq("id", replyToIdRaw)
      .maybeSingle();
    if (
      refErr ||
      !ref ||
      ref.deleted_at ||
      canonicalWhatsAppPeer(ref.peer_e164 as string) !== peerNorm ||
      (ref.business_e164 && ref.business_e164 !== businessLine)
    ) {
      return NextResponse.json({ error: "Invalid reply reference for this chat" }, { status: 400 });
    }
    replyToId = ref.id as string;
    replyToMessageId = (ref.message_sid as string | null)?.trim() || null;
    if (replyToMessageId) {
      replyToMessageId = await resolveExotelQuoteMessageId(replyToMessageId);
    } else {
      console.warn("[whatsapp/send] reply reference has no message_sid; sending without quote context");
    }
  }

  try {
    let resolvedMediaUrl = body?.mediaUrl?.trim() || undefined;
    if (resolvedMediaUrl && messageTypeRaw !== "template" && messageTypeRaw !== "text") {
      resolvedMediaUrl = await resolveOutboundMediaUrl({
        mediaUrl: resolvedMediaUrl,
        userId: user.id,
        request,
      });
    }

    const sent = await dispatchExotelWhatsAppOutbound({
      fromE164: businessLine,
      toE164: normalizePhone(to),
      messageType: messageTypeRaw === "template" || mustUseTemplate ? "template" : messageTypeRaw,
      text: body?.text,
      templateName,
      templateLanguage,
      templateVariables,
      mediaUrl: resolvedMediaUrl,
      mediaCaption: body?.mediaCaption,
      mediaFilename: body?.mediaFilename,
      replyToMessageId,
      location: body?.location
        ? {
            latitude: Number(body.location.latitude),
            longitude: Number(body.location.longitude),
            name: body.location.name,
            address: body.location.address,
          }
        : undefined,
      interactiveBody: body?.interactiveBody,
      interactiveButtons: (body?.interactiveButtons ?? []).map((b) => ({
        id: String(b.id ?? "").trim(),
        title: String(b.title ?? "").trim(),
      })),
    });

    const logBody =
      sent.contentType === "template"
        ? formatTemplatePreview(templateConfig, templateVariables)
        : sent.logBody;

    const logRow = {
      user_id: user.id,
      direction: "outbound" as const,
      peer_e164: peerNorm,
      business_e164: businessLine,
      from_addr: businessLine,
      to_addr: normalizePhone(to),
      body: logBody,
      message_sid: sent.sid,
      num_media: sent.numMedia,
      media_url: sent.mediaUrl,
      content_type: sent.contentType,
      template_name: sent.contentType === "template" ? templateName : null,
      reply_to_id: replyToId,
      delivery_status: "sent",
    };

    let logErr: { message: string; code?: string } | null = null;
    try {
      const svc = createServiceSupabase();
      const { error } = await svc.from("whatsapp_messages").insert(logRow);
      logErr = error;
    } catch {
      const { error } = await supabase.from("whatsapp_messages").insert(logRow);
      logErr = error;
    }

    if (logErr) {
      const dup = (logErr as { code?: string }).code === "23505";
      if (!dup && !String(logErr.message).includes("does not exist")) {
        console.error("[whatsapp/send] log insert:", logErr);
        return NextResponse.json(
          {
            error: `WhatsApp API accepted the message but saving failed: ${logErr.message}`,
            messageSid: sent.sid,
            peerE164: peerNorm,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      messageSid: sent.sid,
      peerE164: peerNorm,
      messageType: sent.contentType,
      sessionOpen,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send WhatsApp message";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
