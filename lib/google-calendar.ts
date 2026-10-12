import "server-only";

import { randomUUID } from "node:crypto";
import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { extrasToPayload, type EventExtras } from "@/lib/calendar-extras";
import { firstRrule, replaceRrule, rruleCount, rruleWithCount, rruleWithUntil } from "@/lib/calendar-recurrence";
import { addDaysToDate, untilDateValue, utcMsToWall, utcStamp, wallForGoogle } from "@/lib/calendar-time";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_INSUFFICIENT_SCOPE = "CALENDAR_INSUFFICIENT_SCOPE";

export type CalendarEventItem = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
    optional?: boolean;
    comment?: string;
    resource?: boolean;
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  recurrence?: string[];
  recurringEventId?: string;
  /** For an instance of a repeating event: when it was originally scheduled (before any one-off change). */
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
  visibility?: string;
  transparency?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  colorId?: string;
  attachments?: { fileUrl?: string; title?: string; mimeType?: string; fileId?: string }[];
  /** The Google Meet join link, once the event has one. */
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
    conferenceSolution?: { name?: string };
    /** While Google is still setting the Meet up, `statusCode` is "pending"; "failure" if it couldn't. */
    createRequest?: { status?: { statusCode?: string } };
  };
};

/**
 * `conferenceData` that asks Google to create a Meet room for an event. Needs
 * `conferenceDataVersion=1` on the request, and the calendar.events scope we already have.
 * `requestId` must be unique per request — a repeat of one Google has seen is treated as a retry.
 */
function newMeetRequest() {
  return { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
}

/** The Meet join link of an event, from `hangoutLink` or its video entry point. */
export function meetLinkOf(event: Pick<CalendarEventItem, "hangoutLink" | "conferenceData">): string | undefined {
  return (
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ||
    undefined
  );
}

/** "created" if the event has a Meet link, "pending" if Google is still making it, "failed" otherwise. */
export function meetStatusOf(event: CalendarEventItem): "created" | "pending" | "failed" {
  if (meetLinkOf(event)) return "created";
  return event.conferenceData?.createRequest?.status?.statusCode === "pending" ? "pending" : "failed";
}

/**
 * Meet rooms are usually ready in the create response, but Google can answer "pending" first.
 * Look again a few times, briefly, so the person gets the link now instead of an empty event.
 */
async function settleMeetLink(accessToken: string, event: CalendarEventItem): Promise<CalendarEventItem> {
  let current = event;
  for (let i = 0; i < 4 && meetStatusOf(current) === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      current = await getCalendarEvent(accessToken, event.id);
    } catch {
      break;
    }
  }
  return current;
}

export type RsvpStatus = "accepted" | "declined" | "tentative";

export type FreeBusySlot = { start: string; end: string };

export type FreeBusyResult = {
  calendars: Record<string, { busy: FreeBusySlot[] }>;
};

export type SendUpdates = "all" | "externalOnly" | "none";

/** A guest as sent to Google. Existing guests should go back with their status, so a patch doesn't reset replies. */
export type GuestInput = { email: string; responseStatus?: string; optional?: boolean; comment?: string };

function toErrorCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return CALENDAR_INSUFFICIENT_SCOPE;
  return `HTTP_${status}`;
}

async function parseGoogleErrorBody(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`.trim();
  try {
    const json = (await res.json()) as {
      error?: { message?: string; status?: string };
    };
    return json?.error?.message || json?.error?.status || fallback;
  } catch {
    return fallback;
  }
}

export type CalendarEventsPage = {
  events: CalendarEventItem[];
  nextPageToken?: string;
};

/**
 * List events from any Google Calendar.
 * For the signed-in user's primary calendar, prefer listPrimaryCalendarEvents.
 */
export async function listCalendarEventsPage(
  accessToken: string,
  calendarId: string,
  opts: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    iCalUID?: string;
    pageToken?: string;
    /** Free-text search — cannot combine with orderBy=startTime. */
    q?: string;
  } = {}
): Promise<CalendarEventsPage> {
  const cal = encodeURIComponent(calendarId.trim() || "primary");
  const u = new URL(`${CALENDAR_API}/calendars/${cal}/events`);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("maxResults", String(Math.min(250, opts.maxResults ?? 250)));
  const q = opts.q?.trim();
  if (q) {
    u.searchParams.set("q", q);
  } else {
    u.searchParams.set("orderBy", "startTime");
  }
  if (opts.timeMin) u.searchParams.set("timeMin", opts.timeMin);
  if (opts.timeMax) u.searchParams.set("timeMax", opts.timeMax);
  if (opts.iCalUID) u.searchParams.set("iCalUID", opts.iCalUID);
  if (opts.pageToken) u.searchParams.set("pageToken", opts.pageToken);

  let res: Response;
  try {
    res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (list events)")
    );
  }

  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar events failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }

  const body = (await res.json()) as {
    items?: CalendarEventItem[];
    nextPageToken?: string;
  };
  return { events: body.items || [], nextPageToken: body.nextPageToken };
}

/** @deprecated Use listCalendarEventsPage — kept for callers expecting a flat array. */
export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number; iCalUID?: string } = {}
): Promise<CalendarEventItem[]> {
  const page = await listCalendarEventsPage(accessToken, calendarId, opts);
  return page.events;
}

export async function listPrimaryCalendarEvents(
  accessToken: string,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number; iCalUID?: string } = {}
): Promise<CalendarEventItem[]> {
  const cap = Math.min(2500, Math.max(1, opts.maxResults ?? 500));
  const out: CalendarEventItem[] = [];
  let pageToken: string | undefined;
  while (out.length < cap) {
    const page = await listCalendarEventsPage(accessToken, "primary", {
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      iCalUID: opts.iCalUID,
      maxResults: Math.min(250, cap - out.length),
      pageToken,
    });
    out.push(...page.events);
    pageToken = page.nextPageToken;
    if (!pageToken || page.events.length === 0) break;
  }
  return out;
}

/** Full-text search across primary calendar (Google Calendar `q` param). */
export async function searchPrimaryCalendarEvents(
  accessToken: string,
  query: string,
  opts: { maxResults?: number } = {}
): Promise<CalendarEventItem[]> {
  const q = query.trim();
  if (!q) return [];
  const cap = Math.min(250, Math.max(1, opts.maxResults ?? 100));
  const now = Date.now();
  const timeMin = new Date(now - 730 * 86400000).toISOString();
  const timeMax = new Date(now + 730 * 86400000).toISOString();
  const out: CalendarEventItem[] = [];
  let pageToken: string | undefined;
  while (out.length < cap) {
    const page = await listCalendarEventsPage(accessToken, "primary", {
      q,
      timeMin,
      timeMax,
      maxResults: Math.min(250, cap - out.length),
      pageToken,
    });
    out.push(...page.events);
    pageToken = page.nextPageToken;
    if (!pageToken || page.events.length === 0) break;
  }
  out.sort((a, b) => {
    const ta = Date.parse(a.start.dateTime || a.start.date || "");
    const tb = Date.parse(b.start.dateTime || b.start.date || "");
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });
  return out.slice(0, cap);
}

export async function getCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<CalendarEventItem> {
  const url = `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (get event)")
    );
  }
  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar event failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }
  return (await res.json()) as CalendarEventItem;
}

export async function queryCalendarFreeBusy(
  accessToken: string,
  input: { timeMin: string; timeMax: string; calendarIds: string[] }
): Promise<FreeBusyResult> {
  const ids = Array.from(new Set(input.calendarIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return { calendars: {} };

  let res: Response;
  try {
    res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        items: ids.map((id) => ({ id })),
      }),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (freeBusy)")
    );
  }
  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar freeBusy failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }
  const body = (await res.json()) as FreeBusyResult;
  return { calendars: body.calendars ?? {} };
}

/** Update one guest's RSVP (organizer token may set any attendee response). */
export async function updateCalendarEventRsvp(
  accessToken: string,
  eventId: string,
  attendeeEmail: string,
  responseStatus: RsvpStatus,
  opts: { sendUpdates?: SendUpdates; comment?: string } = {}
): Promise<CalendarEventItem> {
  const event = await getCalendarEvent(accessToken, eventId);
  const target = attendeeEmail.trim().toLowerCase();
  // Every guest goes back as it came (status, optional, note) — a patch replaces the whole list.
  const attendees = (event.attendees ?? []).map((a) => {
    const keep = {
      email: a.email!,
      responseStatus: a.responseStatus,
      ...(a.optional ? { optional: true } : {}),
      ...(a.comment ? { comment: a.comment } : {}),
    };
    if (a.email?.trim().toLowerCase() === target) {
      const comment = opts.comment?.trim();
      return { ...keep, responseStatus, ...(comment ? { comment: comment.slice(0, 1000) } : {}) };
    }
    return keep;
  });
  if (!attendees.some((a) => a.email?.trim().toLowerCase() === target)) {
    throw new Error("You are not listed as a guest on this event.");
  }
  return patchCalendarEvent(accessToken, eventId, {
    attendees: attendees.filter((a) => a.email) as { email: string }[],
    sendUpdates: opts.sendUpdates ?? "all",
  });
}

/**
 * Generic create — accepts the Google Calendar event shape directly.
 * Used by POST /api/calendar/events from both web and mobile.
 *
 * Pass `sendUpdates` to control attendee email notifications.
 */
export async function createCalendarEvent(
  accessToken: string,
  input: {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: GuestInput[];
    sendUpdates?: SendUpdates;
    recurrence?: string[];
    /** Also create a Google Meet room for the event. */
    addMeetLink?: boolean;
    /** Reminders, guest permissions, visibility, busy/free, attachments. */
    extras?: EventExtras;
  }
): Promise<CalendarEventItem> {
  const { sendUpdates, addMeetLink, extras, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest, ...extrasToPayload(extras) };
  if (addMeetLink) payload.conferenceData = newMeetRequest();
  const params = new URLSearchParams();
  if (sendUpdates) params.set("sendUpdates", sendUpdates);
  if (addMeetLink) params.set("conferenceDataVersion", "1");
  if (extras?.attachments?.length) params.set("supportsAttachments", "true");
  const qs = params.toString();
  const url = qs
    ? `${CALENDAR_API}/calendars/primary/events?${qs}`
    : `${CALENDAR_API}/calendars/primary/events`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (create event)")
    );
  }
  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar create failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }
  const created = (await res.json()) as CalendarEventItem;
  return addMeetLink ? settleMeetLink(accessToken, created) : created;
}

export async function patchCalendarEvent(
  accessToken: string,
  eventId: string,
  input: {
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: GuestInput[];
    sendUpdates?: SendUpdates;
    recurrence?: string[];
    /** Add a Google Meet room to an event that doesn't have one. */
    addMeetLink?: boolean;
    /** Reminders, guest permissions, visibility, busy/free, attachments. */
    extras?: EventExtras;
    /** Restore a deleted (cancelled) event, or cancel one. */
    status?: "confirmed" | "cancelled";
  }
): Promise<CalendarEventItem> {
  const { sendUpdates, addMeetLink, extras, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest, ...extrasToPayload(extras) };
  if (addMeetLink) payload.conferenceData = newMeetRequest();
  const params = new URLSearchParams();
  if (sendUpdates) params.set("sendUpdates", sendUpdates);
  if (addMeetLink) params.set("conferenceDataVersion", "1");
  if (extras?.attachments !== undefined) params.set("supportsAttachments", "true");
  const qs = params.toString();
  const base = `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const url = qs ? `${base}?${qs}` : base;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (patch event)")
    );
  }
  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar patch failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }
  const patched = (await res.json()) as CalendarEventItem;
  return addMeetLink ? settleMeetLink(accessToken, patched) : patched;
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  opts: { sendUpdates?: SendUpdates } = {}
): Promise<void> {
  const base = `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const url = opts.sendUpdates ? `${base}?sendUpdates=${opts.sendUpdates}` : base;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (delete event)")
    );
  }
  // 204 = success, 404/410 = already gone — treat both as ok
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar delete failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }
}

/**
 * Placement-meeting / recruiter-call create. Builds a structured event.
 * The calendar id can be the user's "primary" or another calendar id;
 * pass admin/owner email(s) via `extraAttendeeEmails` so they get invites.
 *
 * (Was named `createCalendarEvent` on the chetan branch — renamed to
 * `createPlacementMeetingEvent` here so it doesn't collide with the generic
 * `createCalendarEvent` above used by POST /api/calendar/events.)
 */
export async function createPlacementMeetingEvent(
  accessToken: string,
  calendarId: string,
  input: {
    recruiterEmail: string;
    /** Meeting title — required. */
    title: string;
    notes?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
    /** Extra invitees added to the event. */
    extraAttendeeEmails?: string[];
    /** Whether to send invite emails to attendees. Defaults to "all". */
    sendUpdates?: SendUpdates;
    recurrence?: string[];
    /** Also create a Google Meet room for the event (its link goes out in the invite). */
    addMeetLink?: boolean;
    /** An all-day event instead of a timed one: first day, and the day AFTER the last ("YYYY-MM-DD"). */
    allDay?: { startDate: string; endDate: string };
    /** Reminders, guest permissions, visibility, busy/free, attachments. */
    extras?: EventExtras;
  }
): Promise<CalendarEventItem> {
  const seen = new Set<string>();
  const attendees: { email: string }[] = [];
  const add = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || seen.has(e)) return;
    seen.add(e);
    attendees.push({ email: e });
  };

  add(input.recruiterEmail);
  for (const email of input.extraAttendeeEmails ?? []) {
    add(email);
  }

  const sendUpdates: SendUpdates = input.sendUpdates ?? "all"; // default: send emails
  const payload: Record<string, unknown> = {
    summary: input.title.trim(),
    description: input.notes?.trim() || undefined,
    location: input.location?.trim() || undefined,
    start: input.allDay
      ? { date: input.allDay.startDate }
      : { dateTime: input.startDateTime, timeZone: input.timeZone || "Asia/Kolkata" },
    end: input.allDay
      ? { date: input.allDay.endDate }
      : { dateTime: input.endDateTime, timeZone: input.timeZone || "Asia/Kolkata" },
    ...(attendees.length ? { attendees } : {}),
    guestsCanInviteOthers: false,
    ...(input.recurrence?.length ? { recurrence: input.recurrence } : {}),
    ...(input.addMeetLink ? { conferenceData: newMeetRequest() } : {}),
    // The chosen settings win over the defaults above (e.g. guests may invite others).
    ...extrasToPayload(input.extras),
  };

  let res: Response;
  try {
    const cal = encodeURIComponent(calendarId.trim() || "primary");
    const qp = new URLSearchParams();
    qp.set("sendUpdates", sendUpdates);
    if (input.addMeetLink) qp.set("conferenceDataVersion", "1");
    if (input.extras?.attachments?.length) qp.set("supportsAttachments", "true");
    res = await fetch(`${CALENDAR_API}/calendars/${cal}/events?${qp.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Calendar API (create event)")
    );
  }

  if (!res.ok) {
    const msg = await parseGoogleErrorBody(res);
    const err = new Error(`Google Calendar create event failed: ${msg}`) as Error & {
      code?: string;
    };
    err.code = toErrorCode(res.status);
    throw err;
  }

  const created = (await res.json()) as CalendarEventItem;
  return input.addMeetLink ? settleMeetLink(accessToken, created) : created;
}

/** Creates a placement-meeting event on the signed-in user's primary calendar. */
export async function createPrimaryCalendarEvent(
  accessToken: string,
  input: Parameters<typeof createPlacementMeetingEvent>[2]
): Promise<CalendarEventItem> {
  return createPlacementMeetingEvent(accessToken, "primary", input);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Repeating events: change or delete "this event", "this and following events" or
 * "all events", and undo.
 *
 * Google models a series as a master event plus instances. Changing one occurrence is a
 * plain edit of the instance. Changing all of them edits the master. "This and following"
 * has no API call: the master is cut short just before that occurrence (an UNTIL on its
 * rule) and a NEW series is created from that occurrence on — the same thing Google
 * Calendar's own screen does.
 * ─────────────────────────────────────────────────────────────────────────── */

export type SeriesScope = "this" | "following" | "all";

type EventTime = { dateTime?: string; date?: string; timeZone?: string };

/** Every instance of a repeating event in a window. */
export async function listEventInstances(
  accessToken: string,
  masterId: string,
  opts: { timeMin?: string; timeMax?: string } = {}
): Promise<CalendarEventItem[]> {
  const out: CalendarEventItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const u = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(masterId)}/instances`);
    u.searchParams.set("maxResults", "2500");
    if (opts.timeMin) u.searchParams.set("timeMin", opts.timeMin);
    if (opts.timeMax) u.searchParams.set("timeMax", opts.timeMax);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    let res: Response;
    try {
      res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    } catch (e) {
      throw new Error(describeUpstreamFetchError(e, "Google Calendar API (list instances)"));
    }
    if (!res.ok) {
      const msg = await parseGoogleErrorBody(res);
      const err = new Error(`Google Calendar instances failed: ${msg}`) as Error & { code?: string };
      err.code = toErrorCode(res.status);
      throw err;
    }
    const data = (await res.json()) as { items?: CalendarEventItem[]; nextPageToken?: string };
    out.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function timeMs(t: EventTime | undefined): number {
  if (!t) return NaN;
  return t.dateTime ? Date.parse(t.dateTime) : t.date ? Date.parse(`${t.date}T00:00:00Z`) : NaN;
}

/** Whether `instance` is the first occurrence of `master`'s series. */
function isFirstOccurrence(master: CalendarEventItem, instance: CalendarEventItem): boolean {
  return timeMs(instance.originalStartTime ?? instance.start) === timeMs(master.start);
}

/** Move an event time by a number of WALL-CLOCK minutes (so a daylight-saving change doesn't skew the series). */
function shiftWall(t: EventTime, minutes: number, fromTz: string, toTz: string): EventTime {
  if (t.date) return { date: addDaysToDate(t.date, Math.round(minutes / 1440)) };
  const wall = utcMsToWall(Date.parse(t.dateTime!), fromTz); // "YYYY-MM-DDTHH:mm"
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall)!;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + minutes * 60_000;
  return { dateTime: wallForGoogle(new Date(naive).toISOString().slice(0, 16)), timeZone: toTz };
}

/** `UNTIL` value that ends a series just before `instance`. */
function untilBefore(instance: CalendarEventItem): string {
  const orig = instance.originalStartTime ?? instance.start;
  return orig.date ? untilDateValue(addDaysToDate(orig.date, -1)) : utcStamp(Date.parse(orig.dateTime!) - 1000);
}

/** Cut the series so it ends just before `instance`. Returns the rule lines it had, for undo. */
async function truncateSeriesBefore(
  accessToken: string,
  master: CalendarEventItem,
  instance: CalendarEventItem,
  sendUpdates: SendUpdates
): Promise<string[]> {
  const rule = firstRrule(master.recurrence);
  if (!rule) throw new Error("This event doesn't repeat.");
  const previous = master.recurrence ?? [];
  await patchCalendarEvent(accessToken, master.id, {
    recurrence: replaceRrule(previous, [rruleWithUntil(rule, untilBefore(instance))]),
    sendUpdates,
  });
  return previous;
}

export type SeriesPatch = {
  summary?: string;
  description?: string;
  location?: string;
  /** The edited occurrence's own start/end — used for "this" and "following". */
  start?: EventTime;
  end?: EventTime;
  attendees?: GuestInput[];
  recurrence?: string[];
  sendUpdates?: SendUpdates;
  addMeetLink?: boolean;
  extras?: EventExtras;
  /** "all": how far the edited occurrence's wall-clock start/end moved, in minutes, and the zones involved. */
  startShiftMinutes?: number;
  endShiftMinutes?: number;
  timeZone?: string;
  originalTimeZone?: string;
};

/**
 * Edit a repeating event's occurrence, the occurrences from it on, or the whole series.
 * `eventId` is the occurrence the person opened. Returns the changed event (for "following", the new series).
 */
export async function editEventInScope(
  accessToken: string,
  eventId: string,
  scope: SeriesScope,
  patch: SeriesPatch
): Promise<CalendarEventItem> {
  const sendUpdates = patch.sendUpdates ?? "all";
  const { startShiftMinutes, endShiftMinutes, timeZone, originalTimeZone, ...fields } = patch;

  if (scope === "this") return patchCalendarEvent(accessToken, eventId, fields);

  const instance = await getCalendarEvent(accessToken, eventId);
  if (!instance.recurringEventId) return patchCalendarEvent(accessToken, eventId, fields); // not part of a series
  const master = instance.recurringEventId === instance.id ? instance : await getCalendarEvent(accessToken, instance.recurringEventId);

  // "this and following" from the very first occurrence is just "all".
  const effective: SeriesScope = scope === "following" && isFirstOccurrence(master, instance) ? "all" : scope;

  if (effective === "all") {
    const { start: _s, end: _e, ...rest } = fields;
    void _s;
    void _e;
    const body: Parameters<typeof patchCalendarEvent>[2] = { ...rest, sendUpdates };
    const oldTz = originalTimeZone || master.start?.timeZone || timeZone || "UTC";
    const newTz = timeZone || oldTz;
    if (master.start && (startShiftMinutes || timeZone)) body.start = shiftWall(master.start, startShiftMinutes ?? 0, oldTz, newTz);
    if (master.end && (endShiftMinutes || timeZone)) body.end = shiftWall(master.end, endShiftMinutes ?? 0, oldTz, newTz);
    return patchCalendarEvent(accessToken, master.id, body);
  }

  // following: end the old series just before this occurrence, start a new one from it.
  const rule = firstRrule(master.recurrence);
  let remainingCount: number | null = null;
  const total = rule ? rruleCount(rule) : null;
  if (total !== null) {
    const before = (
      await listEventInstances(accessToken, master.id, {
        timeMin: new Date(timeMs(master.start)).toISOString(),
        timeMax: new Date(timeMs(instance.originalStartTime ?? instance.start)).toISOString(),
      })
    ).filter((i) => i.status !== "cancelled").length;
    remainingCount = Math.max(1, total - before);
  }
  await truncateSeriesBefore(accessToken, master, instance, "none");

  const tz = timeZone || instance.start?.timeZone || master.start?.timeZone || originalTimeZone || "UTC";
  const withZone = (t: EventTime | undefined): EventTime | undefined => (t && t.dateTime && !t.timeZone ? { ...t, timeZone: tz } : t);
  const recurrence =
    fields.recurrence ??
    (rule
      ? replaceRrule(master.recurrence, [remainingCount !== null ? rruleWithCount(rule, remainingCount) : rule])
      : undefined);
  const hadMeet = !!(master.hangoutLink || master.conferenceData?.entryPoints?.length);

  return createCalendarEvent(accessToken, {
    summary: fields.summary ?? master.summary ?? "",
    description: fields.description ?? master.description,
    location: fields.location ?? master.location,
    start: withZone(fields.start ?? instance.start)!,
    end: withZone(fields.end ?? instance.end)!,
    attendees:
      fields.attendees ??
      (master.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => ({ email: a.email!, ...(a.optional ? { optional: true } : {}) })),
    recurrence,
    sendUpdates,
    addMeetLink: fields.addMeetLink ?? hadMeet,
    extras: {
      // What the master had, unless this edit changes it.
      reminders: master.reminders?.useDefault === false
        ? { useDefault: false, overrides: (master.reminders.overrides ?? []).filter((o) => o.method === "popup" || o.method === "email").map((o) => ({ method: o.method as "popup" | "email", minutes: o.minutes ?? 10 })) }
        : { useDefault: true },
      ...(master.visibility ? { visibility: master.visibility as "default" | "public" | "private" | "confidential" } : {}),
      ...(master.transparency ? { transparency: master.transparency as "opaque" | "transparent" } : {}),
      ...(master.guestsCanModify !== undefined ? { guestsCanModify: master.guestsCanModify } : {}),
      ...(master.guestsCanInviteOthers !== undefined ? { guestsCanInviteOthers: master.guestsCanInviteOthers } : {}),
      ...(master.guestsCanSeeOtherGuests !== undefined ? { guestsCanSeeOtherGuests: master.guestsCanSeeOtherGuests } : {}),
      ...(master.attachments?.length
        ? { attachments: master.attachments.filter((a) => a.fileUrl).map((a) => ({ fileUrl: a.fileUrl!, title: a.title, mimeType: a.mimeType, fileId: a.fileId })) }
        : {}),
      ...fields.extras,
    },
  });
}

/** What happened on a delete — enough for `undoDelete`. */
export type DeleteOutcome = { mode: "deleted" | "truncated"; eventId: string; previousRecurrence?: string[] };

/** Delete an occurrence, the occurrences from it on, or the whole series. */
export async function deleteEventInScope(
  accessToken: string,
  eventId: string,
  scope: SeriesScope,
  opts: { sendUpdates?: SendUpdates } = {}
): Promise<DeleteOutcome> {
  const sendUpdates = opts.sendUpdates ?? "all";
  if (scope === "this") {
    await deleteCalendarEvent(accessToken, eventId, { sendUpdates });
    return { mode: "deleted", eventId };
  }
  const instance = await getCalendarEvent(accessToken, eventId);
  if (!instance.recurringEventId) {
    await deleteCalendarEvent(accessToken, eventId, { sendUpdates });
    return { mode: "deleted", eventId };
  }
  const masterId = instance.recurringEventId;
  if (scope === "all") {
    await deleteCalendarEvent(accessToken, masterId, { sendUpdates });
    return { mode: "deleted", eventId: masterId };
  }
  const master = masterId === instance.id ? instance : await getCalendarEvent(accessToken, masterId);
  if (isFirstOccurrence(master, instance)) {
    await deleteCalendarEvent(accessToken, masterId, { sendUpdates });
    return { mode: "deleted", eventId: masterId };
  }
  const previousRecurrence = await truncateSeriesBefore(accessToken, master, instance, sendUpdates);
  return { mode: "truncated", eventId: masterId, previousRecurrence };
}

/** Reverse a delete: bring a deleted event back, or give a shortened series its old rule back. */
export async function undoDelete(
  accessToken: string,
  outcome: DeleteOutcome,
  opts: { sendUpdates?: SendUpdates } = {}
): Promise<CalendarEventItem> {
  const sendUpdates = opts.sendUpdates ?? "all";
  if (outcome.mode === "truncated") {
    if (!outcome.previousRecurrence?.length) throw new Error("Nothing to restore.");
    return patchCalendarEvent(accessToken, outcome.eventId, { recurrence: outcome.previousRecurrence, sendUpdates });
  }
  return patchCalendarEvent(accessToken, outcome.eventId, { status: "confirmed", sendUpdates });
}
