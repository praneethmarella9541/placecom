import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  listCalendarEvents,
  listPrimaryCalendarEvents,
} from "@/lib/google-calendar";
import {
  canUseMeetOrganizerToken,
  getMeetOrganizerAccessToken,
  isMeetOrganizerAccountEmail,
} from "@/lib/google-meet-organizer";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const useOrganizerCalendar = await canUseMeetOrganizerToken();
  let accessToken: string;
  let calendarId = "primary";

  if (useOrganizerCalendar) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      accessToken = await getMeetOrganizerAccessToken({
        sessionProviderToken: isMeetOrganizerAccountEmail(user.email)
          ? session?.provider_token
          : null,
      });
      calendarId = "primary";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Meet organizer token unavailable";
      return NextResponse.json({ error: msg }, { status: 401 });
    }
  } else {
    const auth = await requireGmailAccessToken();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }
    accessToken = auth.accessToken;
  }

  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin") || undefined;
  const timeMax = searchParams.get("timeMax") || undefined;
  const maxResults = Math.min(
    250,
    Math.max(1, parseInt(searchParams.get("maxResults") || "100", 10) || 100)
  );

  try {
    const events =
      calendarId === "primary" && !useOrganizerCalendar
        ? await listPrimaryCalendarEvents(accessToken, {
            timeMin,
            timeMax,
            maxResults,
          })
        : await listCalendarEvents(accessToken, calendarId, {
            timeMin,
            timeMax,
            maxResults,
          });
    return NextResponse.json({ events });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        {
          error: isMeetOrganizerAccountEmail(user.email)
            ? "Google Calendar session expired. Sign out, sign in again with Google as g24072@astra.xlri.ac.in."
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
    return NextResponse.json(
      { error: err.message || "Failed to load calendar events" },
      { status: 500 }
    );
  }
}
