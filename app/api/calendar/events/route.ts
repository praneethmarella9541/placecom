import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  listPrimaryCalendarEvents,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin") || undefined;
  const timeMax = searchParams.get("timeMax") || undefined;
  const maxResults = Math.min(
    250,
    Math.max(1, parseInt(searchParams.get("maxResults") || "100", 10) || 100)
  );

  try {
    const events = await listPrimaryCalendarEvents(auth.accessToken, {
      timeMin,
      timeMax,
      maxResults,
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
