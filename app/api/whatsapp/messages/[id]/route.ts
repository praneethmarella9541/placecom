import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";

export const runtime = "nodejs";

type PatchBody = {
  is_starred?: boolean;
  is_pinned?: boolean;
  soft_delete?: boolean;
};

export async function PATCH(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> }
) {
  const { id } = context.params instanceof Promise ? await context.params : context.params;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("whatsapp_messages")
    .select("id, peer_e164, business_e164")
    .eq("id", id)
    .eq("business_e164", businessLine)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const peer = row.peer_e164 as string;

  if (body.soft_delete === true) {
    const { error } = await supabase
      .from("whatsapp_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("business_e164", businessLine);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.is_starred === "boolean") {
    const { error } = await supabase
      .from("whatsapp_messages")
      .update({ is_starred: body.is_starred })
      .eq("id", id)
      .eq("business_e164", businessLine);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.is_pinned === "boolean") {
    if (body.is_pinned) {
      await supabase
        .from("whatsapp_messages")
        .update({ is_pinned: false })
        .eq("peer_e164", peer)
        .eq("business_e164", businessLine)
        .is("deleted_at", null);
      const { error } = await supabase
        .from("whatsapp_messages")
        .update({ is_pinned: true })
        .eq("id", id)
        .eq("business_e164", businessLine);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("whatsapp_messages")
        .update({ is_pinned: false })
        .eq("id", id)
        .eq("business_e164", businessLine);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "No valid patch fields" }, { status: 400 });
}
