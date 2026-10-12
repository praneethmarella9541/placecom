import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { CALENDAR_INSUFFICIENT_SCOPE, undoDelete, type DeleteOutcome } from "@/lib/google-calendar";

export const runtime = "nodejs";

type Body = { undo?: unknown; sendUpdates?: string };

/** The undo record the DELETE returned, checked — it is sent back by the browser, so it isn't trusted as it is. */
function parseOutcome(raw: unknown, routeId: string): DeleteOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if ((o.mode !== "deleted" && o.mode !== "truncated") || typeof o.eventId !== "string" || !o.eventId) return null;
  // A series master's id is the base of its occurrences' ids, so the route id must belong to it.
  if (o.eventId !== routeId && !routeId.startsWith(`${o.eventId}_`)) return null;
  let previousRecurrence: string[] | undefined;
  if (o.previousRecurrence !== undefined) {
    if (!Array.isArray(o.previousRecurrence) || o.previousRecurrence.length > 20) return null;
    previousRecurrence = [];
    for (const r of o.previousRecurrence) {
      if (typeof r !== "string" || r.length > 500 || !/^(RRULE|EXRULE|RDATE|EXDATE)[:;]/i.test(r)) return null;
      previousRecurrence.push(r);
    }
  }
  return { mode: o.mode, eventId: o.eventId, ...(previousRecurrence ? { previousRecurrence } : {}) };
}

/** POST /api/calendar/events/:id/restore — undo a delete. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const outcome = parseOutcome(body?.undo, id);
  if (!outcome) return NextResponse.json({ error: "Nothing to restore." }, { status: 400 });
  const sendUpdates =
    body?.sendUpdates === "all" || body?.sendUpdates === "externalOnly" || body?.sendUpdates === "none" ? body.sendUpdates : "none";
  try {
    const event = await undoDelete(auth.accessToken, outcome, { sendUpdates });
    return NextResponse.json({ event });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    if (err.code === CALENDAR_INSUFFICIENT_SCOPE) return NextResponse.json({ error: CALENDAR_INSUFFICIENT_SCOPE, message: err.message }, { status: 403 });
    return NextResponse.json({ error: err.message || "Couldn't restore the event" }, { status: 500 });
  }
}
