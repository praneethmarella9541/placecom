import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createCalendarEvent,
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
  // Identify the signed-in user. Cookie session (web) first; if absent we
  // accept Bearer (mobile) further down via requireGmailAccessToken.
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const useOrganizerCalendar = await canUseMeetOrganizerToken();
  let accessToken: string;
  const calendarId = "primary";

  if (useOrganizerCalendar) {
    // Meet-organizer path needs a real cookie user (we read session.provider_token).
    // Bearer-only callers (mobile) fall back to their own Gmail token below.
    if (!user) {
      const auth = await requireGmailAccessToken(request);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.message }, { status: auth.status });
      }
      accessToken = auth.accessToken;
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      try {
        accessToken = await getMeetOrganizerAccessToken({
          sessionProviderToken: isMeetOrganizerAccountEmail(user.email)
            ? session?.provider_token
            : null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meet organizer token unavailable";
        return NextResponse.json({ error: msg }, { status: 401 });
      }
    }
  } else {
    // Standard path — works for both cookie (web) and Bearer (mobile) thanks to
    // requireGmailAccessToken(request).
    const auth = await requireGmailAccessToken(request);
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
    // If we ended up on the organizer path AND have a cookie user signed in
    // as the organizer email, list from "primary" of that token; otherwise
    // list from the signed-in user's primary calendar.
    const events =
      useOrganizerCalendar && user
        ? await listCalendarEvents(accessToken, calendarId, {
            timeMin,
            timeMax,
            maxResults,
          })
        : await listPrimaryCalendarEvents(accessToken, {
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
          error: isMeetOrganizerAccountEmail(user?.email)
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

type CreateBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string }[];
  addMeet?: boolean;
  sendUpdates?: "all" | "externalOnly" | "none";
};

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const summary = (body.summary ?? "").trim();
  if (!summary) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }
  if (!body.start || (!body.start.dateTime && !body.start.date)) {
    return NextResponse.json(
      { error: "start.dateTime or start.date is required" },
      { status: 400 }
    );
  }
  if (!body.end || (!body.end.dateTime && !body.end.date)) {
    return NextResponse.json(
      { error: "end.dateTime or end.date is required" },
      { status: 400 }
    );
  }

  try {
    const event = await createCalendarEvent(auth.accessToken, {
      summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
      attendees: body.attendees,
      addMeet: body.addMeet,
      sendUpdates: body.sendUpdates,
    });
    return NextResponse.json({ event }, { status: 201 });
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
      { error: err.message || "Failed to create event" },
      { status: 500 }
    );
  }
}
