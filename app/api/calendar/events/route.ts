import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createCalendarEvent,
  listPrimaryCalendarEvents,
  searchPrimaryCalendarEvents,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Always list the signed-in user's own primary calendar.
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin") || undefined;
  const timeMax = searchParams.get("timeMax") || undefined;
  const iCalUID = searchParams.get("iCalUID")?.trim() || undefined;
  const q = searchParams.get("q")?.trim() || undefined;
  const maxResults = Math.min(
    2500,
    Math.max(1, parseInt(searchParams.get("maxResults") || "500", 10) || 500)
  );

  try {
    const events = q
      ? await searchPrimaryCalendarEvents(auth.accessToken, q, {
          maxResults: Math.min(250, maxResults),
        })
      : await listPrimaryCalendarEvents(auth.accessToken, {
          timeMin,
          timeMax,
          maxResults,
          iCalUID,
        });
    return NextResponse.json({ events });
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
