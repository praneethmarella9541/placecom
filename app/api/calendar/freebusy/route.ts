import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  queryCalendarFreeBusy,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { timeMin?: string; timeMax?: string; emails?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const timeMin = body.timeMin?.trim();
  const timeMax = body.timeMax?.trim();
  if (!timeMin || !timeMax) {
    return NextResponse.json(
      { error: "timeMin and timeMax are required" },
      { status: 400 }
    );
  }

  const calendarIds = ["primary"];
  for (const raw of body.emails ?? []) {
    const e = raw.trim().toLowerCase();
    if (isValidEmail(e) && !calendarIds.includes(e)) calendarIds.push(e);
  }

  try {
    const result = await queryCalendarFreeBusy(auth.accessToken, {
      timeMin,
      timeMax,
      calendarIds,
    });
    return NextResponse.json({ calendars: result.calendars });
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
      { error: err.message || "Free/busy query failed" },
      { status: 500 }
    );
  }
}
