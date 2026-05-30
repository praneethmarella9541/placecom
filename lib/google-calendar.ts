import "server-only";

import { describeUpstreamFetchError } from "@/lib/fetch-errors";

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
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  hangoutLink?: string;
  recurrence?: string[];
  recurringEventId?: string;
};

export type RsvpStatus = "accepted" | "declined" | "tentative";

export type FreeBusySlot = { start: string; end: string };

export type FreeBusyResult = {
  calendars: Record<string, { busy: FreeBusySlot[] }>;
};

export type SendUpdates = "all" | "externalOnly" | "none";

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
 * List events from any Google Calendar (e.g. the Meet-organizer calendar).
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
  opts: { sendUpdates?: SendUpdates } = {}
): Promise<CalendarEventItem> {
  const event = await getCalendarEvent(accessToken, eventId);
  const target = attendeeEmail.trim().toLowerCase();
  const attendees = (event.attendees ?? []).map((a) => {
    if (a.email?.trim().toLowerCase() === target) {
      return { email: a.email, responseStatus };
    }
    return { email: a.email!, responseStatus: a.responseStatus };
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
 * Pass `addMeet: true` to auto-create a Google Meet link (requires
 * the conferenceDataVersion=1 query param, set below).
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
    attendees?: { email: string }[];
    addMeet?: boolean;
    sendUpdates?: SendUpdates;
    recurrence?: string[];
  }
): Promise<CalendarEventItem> {
  const { addMeet, sendUpdates, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest };
  if (addMeet) {
    payload.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const params = new URLSearchParams();
  if (addMeet) params.set("conferenceDataVersion", "1");
  if (sendUpdates) params.set("sendUpdates", sendUpdates);
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
  return (await res.json()) as CalendarEventItem;
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
    attendees?: { email: string }[];
    addMeet?: boolean;
    sendUpdates?: SendUpdates;
    recurrence?: string[];
  }
): Promise<CalendarEventItem> {
  const { addMeet, sendUpdates, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest };
  if (addMeet) {
    payload.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const params = new URLSearchParams();
  if (addMeet) params.set("conferenceDataVersion", "1");
  if (sendUpdates) params.set("sendUpdates", sendUpdates);
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
  return (await res.json()) as CalendarEventItem;
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
 * Placement-meeting / recruiter-call create. Builds a structured event with
 * Google Meet attached. The calendar id can be the user's "primary" or a
 * dedicated Meet-organizer calendar id; when using a dedicated calendar,
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
    /** Whether to attach a Google Meet conference. Defaults to true. */
    addMeet?: boolean;
    /** Whether to send invite emails to attendees. Defaults to "all". */
    sendUpdates?: SendUpdates;
    recurrence?: string[];
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

  const wantMeet = input.addMeet !== false; // default true
  const sendUpdates: SendUpdates = input.sendUpdates ?? "all"; // default: send emails
  const payload: Record<string, unknown> = {
    summary: input.title.trim(),
    description: input.notes?.trim() || undefined,
    location: input.location?.trim() || undefined,
    start: {
      dateTime: input.startDateTime,
      timeZone: input.timeZone || "Asia/Kolkata",
    },
    end: {
      dateTime: input.endDateTime,
      timeZone: input.timeZone || "Asia/Kolkata",
    },
    attendees,
    guestsCanInviteOthers: false,
    ...(input.recurrence?.length ? { recurrence: input.recurrence } : {}),
    ...(wantMeet && {
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  };

  let res: Response;
  try {
    const cal = encodeURIComponent(calendarId.trim() || "primary");
    const qp = new URLSearchParams();
    if (wantMeet) qp.set("conferenceDataVersion", "1");
    qp.set("sendUpdates", sendUpdates);
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

  return (await res.json()) as CalendarEventItem;
}

/** Creates a placement-meeting event on the signed-in user's primary calendar. */
export async function createPrimaryCalendarEvent(
  accessToken: string,
  input: Parameters<typeof createPlacementMeetingEvent>[2]
): Promise<CalendarEventItem> {
  return createPlacementMeetingEvent(accessToken, "primary", input);
}
