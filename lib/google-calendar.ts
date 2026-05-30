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
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  hangoutLink?: string;
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
  } = {}
): Promise<CalendarEventsPage> {
  const cal = encodeURIComponent(calendarId.trim() || "primary");
  const u = new URL(`${CALENDAR_API}/calendars/${cal}/events`);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", String(Math.min(250, opts.maxResults ?? 250)));
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
