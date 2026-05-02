import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Fireflies webhook structure typically includes meeting ID, summary, transcript, etc.
    // Ensure you verify the webhook signature or origin if provided by Fireflies in production.
    const meetingUrl = body.meeting_url || body.meetingUrl;
    const transcript = body.transcript || body.text || JSON.stringify(body);
    const firefliesId = body.id || body.meeting_id;
    let summaryText = "";
    
    if (body.summary) {
      if (typeof body.summary === "string") {
        summaryText = body.summary;
      } else {
        const parts = [];
        if (body.summary.action_items) parts.push(`Action Items:\n${body.summary.action_items}`);
        if (body.summary.overview) parts.push(`Overview:\n${body.summary.overview}`);
        summaryText = parts.length > 0 ? parts.join("\n\n") : JSON.stringify(body.summary);
      }
    }

    if (!meetingUrl) {
      return NextResponse.json({ error: "Missing meeting URL" }, { status: 400 });
    }

    // Initialize Supabase with service role or use the regular server client if no admin tasks
    const supabase = createServerSupabaseClient();
    
    // Update the meeting recording row with the transcript
    const { error } = await supabase
      .from("meeting_recordings")
      .update({
        transcript: transcript,
        summary: summaryText,
        status: "completed",
        fireflies_id: firefliesId
      })
      .eq("meeting_url", meetingUrl);

    if (error) {
      console.error("Failed to update meeting recording:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Fireflies webhook error:", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
