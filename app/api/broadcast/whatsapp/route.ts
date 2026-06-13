import { NextResponse } from "next/server";
import { getTwilioClient } from "@/lib/twilio";
import {
  getWhatsAppFromAddress,
  isWhatsAppSendConfigured,
  sendWhatsAppSessionMessage,
  toWhatsAppAddress,
} from "@/lib/whatsapp";
import {
  sendExotelWhatsAppText,
  sendExotelWhatsAppTemplate,
  isExotelWhatsAppConfigured,
} from "@/lib/exotel-whatsapp";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { getUserOr401 } from "@/lib/request-auth";
import { normalizeToE164 } from "@/lib/broadcast-phones";
import { peerForOutbound } from "@/lib/whatsapp-address";
import { normalizePhone } from "@/lib/phone";
import { resolveWhatsAppTemplateAsync } from "@/lib/whatsapp-template-resolve";
import { formatTemplatePreview } from "@/lib/whatsapp-template";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_RECIPIENTS = 200;
const MS_BETWEEN_SENDS = 550;

type SessionBody = {
  mode?: "session";
  recipients: string[];
  text: string;
};

type TemplateMergeRow = {
  phone: string;
  /** Values for {{1}}, {{2}}, … */
  variables: string[];
};

type TemplateBody = {
  mode: "template";
  rows: TemplateMergeRow[];
  templateName?: string;
  templateLanguage?: string;
};

type Body = SessionBody | TemplateBody;

export async function POST(request: Request) {
  if (!isWhatsAppSendConfigured()) {
    return NextResponse.json(
      {
        error:
          "WhatsApp is not configured. Set Exotel credentials (EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN) and assign your line under Team.",
      },
      { status: 503 }
    );
  }

  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const useExotel = isExotelWhatsAppConfigured();
  const client = useExotel ? null : getTwilioClient();
  const fromAddr = useExotel ? null : getWhatsAppFromAddress();

  let businessLine: string | null = null;
  if (useExotel) {
    const lineResult = await getUserWhatsAppLine(supabase, user.id);
    if (!lineResult.ok) {
      return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
    }
    businessLine = lineResult.data.line;
  } else if (!client || !fromAddr) {
    return NextResponse.json({ error: "Twilio client unavailable" }, { status: 503 });
  }

  const failed: { phone: string; error: string }[] = [];
  let sent = 0;

  /* ── Template broadcast mode ───────────────────────────────── */
  if (body.mode === "template") {
    if (!useExotel) {
      return NextResponse.json(
        { error: "Template broadcast requires Exotel WhatsApp (Twilio does not support this mode)." },
        { status: 400 }
      );
    }

    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    const rows = rawRows
      .map((r) => ({ phone: normalizeToE164(String(r.phone || "")), variables: (r.variables ?? []).map(String) }))
      .filter((r): r is { phone: string; variables: string[] } => r.phone !== null) as {
        phone: string;
        variables: string[];
      }[];

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid phone numbers found in the list." }, { status: 400 });
    }
    if (rows.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` }, { status: 400 });
    }

    const templateConfig = await resolveWhatsAppTemplateAsync(body.templateName);

    for (let i = 0; i < rows.length; i++) {
      const { phone, variables } = rows[i];
      const vars = variables.slice(0, templateConfig.bodyParamCount);
      try {
        const result = await sendExotelWhatsAppTemplate({
          fromE164: businessLine!,
          toE164: normalizePhone(phone),
          templateName: templateConfig.name,
          languageCode: body.templateLanguage ?? templateConfig.languageCode,
          bodyVariables: vars,
        });
        const logBody = formatTemplatePreview(templateConfig, vars);
        const { error: logErr } = await supabase.from("whatsapp_messages").insert({
          user_id: user.id,
          direction: "outbound",
          peer_e164: peerForOutbound(phone),
          business_e164: businessLine,
          from_addr: businessLine,
          to_addr: normalizePhone(phone),
          body: logBody,
          message_sid: result.sid,
          num_media: 0,
          content_type: "template",
          template_name: templateConfig.name,
          delivery_status: "sent",
        });
        if (logErr && !String(logErr.message).includes("does not exist")) {
          console.warn("[broadcast/whatsapp/template] log insert:", logErr.message);
        }
        sent++;
      } catch (e) {
        failed.push({ phone, error: e instanceof Error ? e.message : "Send failed" });
      }
      if (i < rows.length - 1) await new Promise((r) => setTimeout(r, MS_BETWEEN_SENDS));
    }

    return NextResponse.json({ sent, failed });
  }

  /* ── Session message mode (existing behavior) ───────────────── */
  const rawList = Array.isArray((body as SessionBody).recipients) ? (body as SessionBody).recipients : [];
  const recipients = Array.from(
    new Set(rawList.map((r) => normalizeToE164(String(r))).filter((r): r is string => r !== null))
  );

  const text = ((body as SessionBody).text ?? "").trim();
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "Add at least one valid phone in E.164 format (e.g. +91 98765 43210)" },
      { status: 400 }
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      let sid: string;
      if (useExotel && businessLine) {
        const result = await sendExotelWhatsAppText({
          fromE164: businessLine,
          toE164: normalizePhone(to),
          body: text,
        });
        sid = result.sid;
        const { error: logErr } = await supabase.from("whatsapp_messages").insert({
          user_id: user.id,
          direction: "outbound",
          peer_e164: peerForOutbound(to),
          business_e164: businessLine,
          from_addr: businessLine,
          to_addr: normalizePhone(to),
          body: text,
          message_sid: sid,
          num_media: 0,
          delivery_status: "sent",
        });
        if (logErr && !String(logErr.message).includes("does not exist")) {
          console.warn("[broadcast/whatsapp] log insert:", logErr.message);
        }
      } else {
        const result = await sendWhatsAppSessionMessage(client!, { toE164: to, body: text });
        sid = result.sid;
        if (fromAddr) {
          const { error: logErr } = await supabase.from("whatsapp_messages").insert({
            user_id: user.id,
            direction: "outbound",
            peer_e164: peerForOutbound(to),
            from_addr: fromAddr,
            to_addr: toWhatsAppAddress(to),
            body: text,
            message_sid: sid,
            num_media: 0,
          });
          if (logErr && !String(logErr.message).includes("does not exist")) {
            console.warn("[broadcast/whatsapp] log insert:", logErr.message);
          }
        }
      }
      sent++;
    } catch (e) {
      failed.push({ phone: to, error: e instanceof Error ? e.message : "Send failed" });
    }
    if (i < recipients.length - 1) await new Promise((r) => setTimeout(r, MS_BETWEEN_SENDS));
  }

  return NextResponse.json({ sent, failed });
}
