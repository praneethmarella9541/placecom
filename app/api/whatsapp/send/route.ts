import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  sendExotelWhatsAppTemplate,
  sendExotelWhatsAppText,
  isExotelWhatsAppConfigured,
} from "@/lib/exotel-whatsapp";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { hasOpenWhatsAppSession } from "@/lib/whatsapp-session";
import {
  formatTemplatePreview,
  getDefaultWhatsAppTemplate,
} from "@/lib/whatsapp-template";
import { peerForOutbound } from "@/lib/whatsapp-address";
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
    text?: string;
    replyToId?: string;
    useTemplate?: boolean;
    templateName?: string;
    templateLanguage?: string;
    templateVariables?: string[];
  } | null;

  const to = body?.to?.trim() || "";
  const text = body?.text?.trim() || "";
  const replyToIdRaw = body?.replyToId?.trim() || "";
  const forceTemplate = body?.useTemplate === true;
  const forceSession = body?.useTemplate === false;

  if (!isValidE164(normalizePhone(to))) {
    return NextResponse.json(
      { error: "Provide recipient in E.164 format, e.g. +919876543210" },
      { status: 400 }
    );
  }

  const peerNorm = peerForOutbound(to);
  const sessionOpen = await hasOpenWhatsAppSession(supabase, peerNorm, businessLine);
  const mustUseTemplate = forceTemplate || (!forceSession && !sessionOpen);

  const templateConfig = getDefaultWhatsAppTemplate();
  const templateName = body?.templateName?.trim() || templateConfig.name;
  const templateLanguage = body?.templateLanguage?.trim() || templateConfig.languageCode;

  let templateVariables = Array.isArray(body?.templateVariables)
    ? body.templateVariables.map((v) => String(v).trim()).filter(Boolean)
    : [];

  if (mustUseTemplate) {
    if (templateVariables.length < templateConfig.bodyParamCount) {
      return NextResponse.json(
        {
          error: `First message must use template "${templateName}". Provide templateVariables with ${templateConfig.bodyParamCount} value(s) for {{1}} and {{2}} (e.g. recipient name, your name).`,
        },
        { status: 400 }
      );
    }
    templateVariables = templateVariables.slice(0, templateConfig.bodyParamCount);
    const missing = templateVariables.findIndex((v) => !v);
    if (missing >= 0) {
      return NextResponse.json(
        {
          error: `Template variable ${missing + 1} is required (maps to {{${missing + 1}}} in your template).`,
        },
        { status: 400 }
      );
    }
  } else if (!text) {
    return NextResponse.json({ error: "text (message body) is required" }, { status: 400 });
  }

  let replyToId: string | null = null;
  if (replyToIdRaw) {
    const { data: ref, error: refErr } = await supabase
      .from("whatsapp_messages")
      .select("id, peer_e164, business_e164, deleted_at")
      .eq("id", replyToIdRaw)
      .maybeSingle();
    if (
      refErr ||
      !ref ||
      ref.deleted_at ||
      ref.peer_e164 !== peerNorm ||
      (ref.business_e164 && ref.business_e164 !== businessLine)
    ) {
      return NextResponse.json({ error: "Invalid reply reference for this chat" }, { status: 400 });
    }
    replyToId = ref.id as string;
  }

  const logBody = mustUseTemplate
    ? formatTemplatePreview(templateConfig, templateVariables)
    : text;

  try {
    const { sid } = mustUseTemplate
      ? await sendExotelWhatsAppTemplate({
          fromE164: businessLine,
          toE164: normalizePhone(to),
          templateName,
          languageCode: templateLanguage,
          bodyVariables: templateVariables,
        })
      : await sendExotelWhatsAppText({
          fromE164: businessLine,
          toE164: normalizePhone(to),
          body: text,
        });

    const { error: logErr } = await supabase.from("whatsapp_messages").insert({
      user_id: user.id,
      direction: "outbound",
      peer_e164: peerNorm,
      business_e164: businessLine,
      from_addr: businessLine,
      to_addr: normalizePhone(to),
      body: logBody,
      message_sid: sid,
      num_media: 0,
      reply_to_id: replyToId,
      delivery_status: "sent",
    });
    if (logErr && !String(logErr.message).includes("does not exist")) {
      console.warn("[whatsapp/send] log insert:", logErr.message);
    }

    return NextResponse.json({
      ok: true,
      messageSid: sid,
      messageType: mustUseTemplate ? "template" : "session",
      sessionOpen,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send WhatsApp message";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
