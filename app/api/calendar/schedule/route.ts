import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createPlacementMeetingEvent,
} from "@/lib/google-calendar";
import {
  canUseMeetOrganizerToken,
  getMeetAdminInviteEmail,
  getMeetOrganizerAccessToken,
  getMeetOrganizerCalendarId,
  isMeetOrganizerAccountEmail,
} from "@/lib/google-meet-organizer";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  // Auth identifies the *requesting* user. Calendar access token may come
  // from a separate Meet-organizer account (if configured) or from the
  // requesting user's own Google session (web cookies) / Bearer token (mobile).
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fall back to Bearer (mobile) when cookie session is absent.
  let signedInUserEmail: string | null = user?.email ?? null;
  if (!user) {
    const bearerAuth = await requireGmailAccessToken(request);
    if (!bearerAuth.ok) {
      return NextResponse.json({ error: bearerAuth.message }, { status: bearerAuth.status });
    }
    // requireGmailAccessToken doesn't surface the email; that's fine — we
    // only use it for Meet-organizer detection below, and Bearer-only callers
    // won't match the organizer email anyway.
    signedInUserEmail = null;
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
  const useOrganizerToken = await canUseMeetOrganizerToken();

  try {
    let calendarAccessToken: string;
    if (useOrganizerToken) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      calendarAccessToken = await getMeetOrganizerAccessToken({
        sessionProviderToken: isMeetOrganizerAccountEmail(signedInUserEmail)
          ? session?.provider_token
          : null,
      });
    } else {
      const auth = await requireGmailAccessToken(request);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.message }, { status: auth.status });
      }
      calendarAccessToken = auth.accessToken;
    }

    const calendarId = useOrganizerToken ? "primary" : meetOrganizerEmail;

    const event = await createPlacementMeetingEvent(
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
    if (hangoutLink && user) {
      try {
        await supabase.from("meeting_recordings").insert({
          user_id: user.id,
          meeting_url: hangoutLink,
          attendee_email: recruiterEmail,
        });
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
        {
          error:
            isMeetOrganizerAccountEmail(signedInUserEmail)
              ? "Google Calendar session expired. Sign out, sign in again with Google as g24072@astra.xlri.ac.in, then retry."
              : "Google token expired. Sign in again.",
        },
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
      !useOrganizerToken && /notFound|forbidden|404|403/i.test(msg);
    return NextResponse.json(
      {
        error: msg,
        hint: needsShare
          ? `${meetOrganizerEmail} must share their Google Calendar with ${adminInviteEmail} (Make changes to events), or sign in as ${meetOrganizerEmail} once.`
          : undefined,
      },
      { status: 500 }
    );
  }
}
