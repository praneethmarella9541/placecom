import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { sendGmailMessage } from "@/lib/gmail";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as {
    recordingId?: string;
  } | null;

  const recordingId = body?.recordingId;
  if (!recordingId) {
    return NextResponse.json({ error: "Missing recordingId" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data: recording, error } = await supabase
    .from("meeting_recordings")
    .select("*")
    .eq("id", recordingId)
    .single();

  if (error || !recording) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  if (recording.user_id !== auth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!recording.attendee_email) {
    return NextResponse.json({ error: "No attendee email available to send to" }, { status: 400 });
  }

  if (!recording.summary) {
    return NextResponse.json({ error: "No summary available to send" }, { status: 400 });
  }

  const subject = "Meeting Summary";
  const emailBody = `Hi,\n\nHere is the summary of our recent meeting:\n\n${recording.summary}\n\nBest regards,\nYour Placement Coordinator`;

  try {
    await sendGmailMessage(auth.accessToken, recording.attendee_email, subject, emailBody);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Failed to send email:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
