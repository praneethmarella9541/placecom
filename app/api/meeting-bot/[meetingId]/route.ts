/**
 * Get a single meeting with its captions inline.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ meetingId: string }> }
) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { meetingId } = await context.params;
  if (!meetingId) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: meeting, error } = await svc
    .from("meetings")
    .select("*")
    .eq("meeting_id", meetingId)
    .eq("user_id", authed.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: captions } = await svc
    .from("captions")
    .select("caption_id, text, speaker, timestamp")
    .eq("meeting_id", meetingId)
    .order("timestamp", { ascending: true })
    .limit(5000);

  return NextResponse.json({ meeting, captions: captions ?? [] });
}
