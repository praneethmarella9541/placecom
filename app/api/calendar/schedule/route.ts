import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createCalendarEvent,
} from "@/lib/google-calendar";
import {
  getMeetAdminInviteEmail,
  getMeetOrganizerAccessToken,
  getMeetOrganizerCalendarId,
  hasMeetOrganizerRefreshToken,
} from "@/lib/google-meet-organizer";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        recruiterEmail?: string;
        companyName?: string;
        startDateTime?: string;
        endDateTime?: string;
        notes?: string;
        title?: string;
      }
    | null;

  const recruiterEmail = body?.recruiterEmail?.trim() || "";
  const companyName = body?.companyName?.trim() || "";
  const startDateTime = body?.startDateTime?.trim() || "";
  const endDateTime = body?.endDateTime?.trim() || "";

  if (!recruiterEmail || !isValidEmail(recruiterEmail)) {
    return NextResponse.json(
      { error: "Valid recruiterEmail is required." },
      { status: 400 }
    );
  }
  if (!companyName) {
    return NextResponse.json(
      { error: "companyName is required." },
      { status: 400 }
    );
  }
  if (!startDateTime || !endDateTime) {
    return NextResponse.json(
      { error: "startDateTime and endDateTime are required." },
      { status: 400 }
    );
  }

  const meetOrganizerEmail = getMeetOrganizerCalendarId();
  const adminInviteEmail = getMeetAdminInviteEmail();

  try {
    const useOrganizerToken = hasMeetOrganizerRefreshToken();
    const calendarAccessToken = useOrganizerToken
      ? await getMeetOrganizerAccessToken()
      : auth.accessToken;
    const calendarId = useOrganizerToken ? "primary" : meetOrganizerEmail;

    const event = await createCalendarEvent(
      calendarAccessToken,
      calendarId,
      {
        recruiterEmail,
        companyName,
        startDateTime,
        endDateTime,
        notes: body?.notes,
        title: body?.title,
        extraAttendeeEmails: [adminInviteEmail],
      }
    );

    const hangoutLink = event.hangoutLink;
    if (hangoutLink) {
      try {
        const { createServerSupabaseClient } = await import("@/lib/supabase-server");
        const supabase = createServerSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          await supabase.from("meeting_recordings").insert({
            user_id: user.id,
            meeting_url: hangoutLink,
            attendee_email: recruiterEmail,
          });
        }
      } catch (err) {
        console.error("Failed to save meeting recording:", err);
      }
    }

    return NextResponse.json(
      {
        event,
        meetOrganizerEmail,
        adminInviteEmail,
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
    const msg = err.message || "Failed to create calendar event";
    const needsShare =
      !hasMeetOrganizerRefreshToken() &&
      /notFound|forbidden|404|403/i.test(msg);
    return NextResponse.json(
      {
        error: msg,
        hint: needsShare
          ? `${meetOrganizerEmail} must share their Google Calendar with ${adminInviteEmail} (Make changes to events), or run npm run auth:meet-organizer signed in as ${meetOrganizerEmail}.`
          : undefined,
      },
      { status: 500 }
    );
  }
}
