import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  updateCalendarEventRsvp,
  type RsvpStatus,
} from "@/lib/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const VALID: RsvpStatus[] = ["accepted", "declined", "tentative"];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: eventId } = await context.params;
  if (!eventId) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  let body: { status?: string; attendeeEmail?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = body.status as RsvpStatus;
  if (!VALID.includes(status)) {
    return NextResponse.json(
      { error: "status must be accepted, declined, or tentative" },
      { status: 400 }
    );
  }

  let attendeeEmail = body.attendeeEmail?.trim().toLowerCase() || "";
  if (!attendeeEmail) {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    attendeeEmail = (user?.email ?? auth.gmailAddress ?? "").trim().toLowerCase();
  }
  if (!attendeeEmail) {
    return NextResponse.json(
      { error: "Could not determine your email for RSVP" },
      { status: 400 }
    );
  }

  try {
    const event = await updateCalendarEventRsvp(
      auth.accessToken,
      eventId,
      attendeeEmail,
      status,
      { sendUpdates: "all" }
    );
    return NextResponse.json({ event });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === CALENDAR_INSUFFICIENT_SCOPE) {
      return NextResponse.json(
        { error: CALENDAR_INSUFFICIENT_SCOPE, message: err.message },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "RSVP failed" },
      { status: 500 }
    );
  }
}
