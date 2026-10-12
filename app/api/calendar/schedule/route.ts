import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createPlacementMeetingEvent,
  meetLinkOf,
  meetStatusOf,
  type SendUpdates,
} from "@/lib/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sanitizeExtras } from "@/lib/calendar-extras";

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
        /** Create a Google Meet room for the meeting. */
        addMeetLink?: boolean;
        /** An all-day event: `startDate` and `endDate` ("YYYY-MM-DD"; endDate is the day AFTER the last day). */
        allDay?: boolean;
        startDate?: string;
        endDate?: string;
        /** Reminders, guest permissions, visibility, busy/free, attachments (validated below). */
        extras?: unknown;
      }
    | null;

  const recruiterEmail = body?.recruiterEmail?.trim() || "";
  const title = body?.title?.trim() || "";
  const allDay = body?.allDay === true;
  const startDate = body?.startDate?.trim() || "";
  const endDate = body?.endDate?.trim() || "";
  const startDateTime = body?.startDateTime?.trim() || "";
  const endDateTime = body?.endDateTime?.trim() || "";
  // A time zone must be a real one — it goes straight into the event.
  const timeZone = body?.timeZone?.trim() || undefined;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      return NextResponse.json({ error: "Unknown time zone." }, { status: 400 });
    }
  }

  // Guests are optional — an out-of-office or a block of focus time has none.
  if (recruiterEmail && !isValidEmail(recruiterEmail)) {
    return NextResponse.json(
      { error: "That guest email address isn't valid." },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json(
      { error: "Meeting title is required." },
      { status: 400 }
    );
  }
  if (allDay) {
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(startDate) || !isDate(endDate)) {
      return NextResponse.json({ error: "startDate and endDate (YYYY-MM-DD) are required for an all-day event." }, { status: 400 });
    }
    if (endDate <= startDate) {
      return NextResponse.json({ error: "An all-day event must end after it starts." }, { status: 400 });
    }
  } else if (!startDateTime || !endDateTime) {
    return NextResponse.json(
      { error: "startDateTime and endDateTime are required." },
      { status: 400 }
    );
  }

  // Build extra attendees:
  //  1. Signed-in user's platform email (always — so the scheduler gets the invite)
  //  2. Any additional emails sent from the client
  const extraAttendeeEmails: string[] = [];
  // (Not for an event with no guests: that one stays on your own calendar.)
  const hasGuests = !!recruiterEmail || (body?.extraAttendeeEmails ?? []).length > 0;
  if (hasGuests && signedInUserEmail && isValidEmail(signedInUserEmail)) {
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
        timeZone,
        ...(allDay ? { allDay: { startDate, endDate } } : {}),
        extras: sanitizeExtras(body?.extras),
        extraAttendeeEmails,
        recurrence: body?.recurrence,
        addMeetLink: body?.addMeetLink === true,
        sendUpdates: body?.sendUpdates ?? "all",     // default: send invite emails
      }
    );

    return NextResponse.json(
      {
        event,
        organizerEmail: organizerGmailAddress,
        scheduledByEmail: signedInUserEmail,
        // Only present when a Meet was asked for: the link, or why there isn't one.
        ...(body?.addMeetLink === true
          ? {
              meetLink: meetLinkOf(event) ?? null,
              meetError:
                meetStatusOf(event) === "created"
                  ? null
                  : "The meeting was created, but Google couldn't add a Meet link to it. You can add one from the event.",
            }
          : {}),
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
