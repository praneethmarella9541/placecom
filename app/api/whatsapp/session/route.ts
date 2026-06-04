import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { hasOpenWhatsAppSessionForPeer } from "@/lib/whatsapp-session";
import { getDefaultWhatsAppTemplate, formatTemplatePreview } from "@/lib/whatsapp-template";
import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }

  const peer = new URL(request.url).searchParams.get("peer")?.trim();
  if (!peer) {
    return NextResponse.json({ error: "peer query required" }, { status: 400 });
  }

  const peerNorm = canonicalWhatsAppPeer(peer);
  if (!peerNorm || !/^\+[1-9]\d{7,14}$/.test(peerNorm)) {
    return NextResponse.json({ error: "Invalid peer phone" }, { status: 400 });
  }

  const sessionOpen = await hasOpenWhatsAppSessionForPeer(
    supabase,
    peerNorm,
    lineResult.data.line
  );
  const template = getDefaultWhatsAppTemplate();

  return NextResponse.json({
    sessionOpen,
    requiresTemplate: !sessionOpen,
    template: {
      name: template.name,
      languageCode: template.languageCode,
      bodyParamCount: template.bodyParamCount,
      previewExample: formatTemplatePreview(template, ["Customer", "Your name"]),
    },
  });
}
