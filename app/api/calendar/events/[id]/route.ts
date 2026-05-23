import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  deleteCalendarEvent,
  patchCalendarEvent,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

type PatchBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string }[];
  addMeet?: boolean;
};

function handleError(e: unknown) {
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
    { error: err.message || "Calendar request failed" },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const event = await patchCalendarEvent(auth.accessToken, id, body);
    return NextResponse.json({ event });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }
  try {
    await deleteCalendarEvent(auth.accessToken, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
