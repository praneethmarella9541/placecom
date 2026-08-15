import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createPlacementMeetingEvent,
  type SendUpdates,
} from "@/lib/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  // Resolve the signed-in user — either cookie (web) or Bearer (mobile).
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Platform login email — added as a default attendee so the scheduler gets the invite.
  const signedInUserEmail: string | null = user?.email ?? null;

  // Resolve Google access token (admin's connected mailbox or own session).
  // gmailAddress = the actual Google account email that owns the calendar.
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const calendarAccessToken = auth.accessToken;
  const organizerGmailAddress = auth.gmailAddress ?? null;

  const body = (await request.json().catch(() => null)) as
    | {
        recruiterEmail?: string;
        title?: string;
        startDateTime?: string;
        endDateTime?: string;
        notes?: string;
        location?: string;
        timeZone?: string;
        sendUpdates?: SendUpdates;
        extraAttendeeEmails?: string[];
        recurrence?: string[];
      }
    | null;

  const recruiterEmail = body?.recruiterEmail?.trim() || "";
  const title = body?.title?.trim() || "";
  const startDateTime = body?.startDateTime?.trim() || "";
  const endDateTime = body?.endDateTime?.trim() || "";

  if (!recruiterEmail || !isValidEmail(recruiterEmail)) {
    return NextResponse.json(
      { error: "Valid recruiterEmail is required." },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json(
      { error: "Meeting title is required." },
      { status: 400 }
    );
  }
  if (!startDateTime || !endDateTime) {
    return NextResponse.json(
      { error: "startDateTime and endDateTime are required." },
      { status: 400 }
    );
  }

  // Build extra attendees:
  //  1. Signed-in user's platform email (always — so the scheduler gets the invite)
  //  2. Any additional emails sent from the client
  const extraAttendeeEmails: string[] = [];
  if (signedInUserEmail && isValidEmail(signedInUserEmail)) {
    const lc = signedInUserEmail.toLowerCase();
    if (
      lc !== organizerGmailAddress?.toLowerCase() &&
      lc !== recruiterEmail.toLowerCase()
    ) {
      extraAttendeeEmails.push(signedInUserEmail);
    }
  }
  for (const email of body?.extraAttendeeEmails ?? []) {
    const e = email.trim();
    if (
      isValidEmail(e) &&
      !extraAttendeeEmails.map((x) => x.toLowerCase()).includes(e.toLowerCase())
    ) {
      extraAttendeeEmails.push(e);
    }
  }

  try {
    const event = await createPlacementMeetingEvent(
      calendarAccessToken,
      "primary",
      {
        recruiterEmail,
        title,
        startDateTime,
        endDateTime,
        notes: body?.notes,
        location: body?.location,
        timeZone: body?.timeZone,
        extraAttendeeEmails,
        recurrence: body?.recurrence,
        sendUpdates: body?.sendUpdates ?? "all",     // default: send invite emails
      }
    );

    return NextResponse.json(
      {
        event,
        organizerEmail: organizerGmailAddress,
        scheduledByEmail: signedInUserEmail,
      },
      { status: 201 }
    );
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
        {
          error: CALENDAR_INSUFFICIENT_SCOPE,
          message:
            "Your Google sign-in is missing Calendar access. Sign out and sign in again to grant calendar scopes.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to create calendar event" },
      { status: 500 }
    );
  }
}
