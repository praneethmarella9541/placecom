import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { sanitizeExtras } from "@/lib/calendar-extras";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  deleteEventInScope,
  editEventInScope,
  getCalendarEvent,
  meetLinkOf,
  meetStatusOf,
  type GuestInput,
  type SeriesScope,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

type SendUpdates = "all" | "externalOnly" | "none";
type EventTime = { dateTime?: string; date?: string; timeZone?: string };

type PatchBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  attendees?: unknown;
  sendUpdates?: SendUpdates;
  recurrence?: string[];
  /** Add a Google Meet room to the event. */
  addMeetLink?: boolean;
  /** Reminders, guest permissions, visibility, busy/free, attachments (validated below). */
  extras?: unknown;
  /** For a repeating event: this occurrence (default), this and the following ones, or all of them. */
  scope?: string;
  /** scope = "all": how far the edited occurrence's wall-clock start/end moved, in minutes, and the zones. */
  startShiftMinutes?: number;
  endShiftMinutes?: number;
  timeZone?: string;
  originalTimeZone?: string;
};

function parseScope(raw: unknown): SeriesScope {
  return raw === "following" || raw === "all" ? raw : "this";
}

function parseSendUpdates(raw: unknown): SendUpdates | undefined {
  return raw === "all" || raw === "externalOnly" || raw === "none" ? raw : undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Guests from a request body: only well-formed ones, with the fields we pass through. */
function cleanGuests(raw: unknown): GuestInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GuestInput[] = [];
  for (const g of raw) {
    if (typeof g !== "object" || g === null) continue;
    const o = g as Record<string, unknown>;
    if (typeof o.email !== "string" || !EMAIL_RE.test(o.email.trim())) continue;
    out.push({
      email: o.email.trim(),
      ...(typeof o.responseStatus === "string" ? { responseStatus: o.responseStatus } : {}),
      ...(o.optional === true ? { optional: true } : {}),
      ...(typeof o.comment === "string" ? { comment: o.comment.slice(0, 1000) } : {}),
    });
  }
  return out;
}

function validZone(tz: unknown): string | undefined {
  if (typeof tz !== "string" || !tz.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return undefined;
  }
}

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(_request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }
  try {
    const event = await getCalendarEvent(auth.accessToken, id);
    return NextResponse.json({ event });
  } catch (e) {
    return handleError(e);
  }
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
    const addMeetLink = body.addMeetLink === true;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
    const event = await editEventInScope(auth.accessToken, id, parseScope(body.scope), {
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
      attendees: cleanGuests(body.attendees),
      recurrence: Array.isArray(body.recurrence) ? body.recurrence.filter((r) => typeof r === "string") : undefined,
      sendUpdates: parseSendUpdates(body.sendUpdates),
      addMeetLink,
      extras: body.extras !== undefined ? sanitizeExtras(body.extras) : undefined,
      startShiftMinutes: num(body.startShiftMinutes),
      endShiftMinutes: num(body.endShiftMinutes),
      timeZone: validZone(body.timeZone),
      originalTimeZone: validZone(body.originalTimeZone),
    });
    return NextResponse.json({
      event,
      ...(addMeetLink
        ? {
            meetLink: meetLinkOf(event) ?? null,
            meetError:
              meetStatusOf(event) === "created" ? null : "Google couldn't add a Meet link to this event.",
          }
        : {}),
    });
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
  const { searchParams } = new URL(request.url);
  const sendUpdates = parseSendUpdates(searchParams.get("sendUpdates"));
  try {
    // `undo` carries what's needed to reverse this delete (POST …/restore).
    const undo = await deleteEventInScope(auth.accessToken, id, parseScope(searchParams.get("scope")), { sendUpdates });
    return NextResponse.json({ ok: true, undo });
  } catch (e) {
    return handleError(e);
  }
}
