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

export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {}
): Promise<CalendarEventItem[]> {
  const cal = encodeURIComponent(calendarId.trim() || "primary");
  const u = new URL(`${CALENDAR_API}/calendars/${cal}/events`);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", String(opts.maxResults ?? 100));
  if (opts.timeMin) u.searchParams.set("timeMin", opts.timeMin);
  if (opts.timeMax) u.searchParams.set("timeMax", opts.timeMax);

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

  const body = (await res.json()) as { items?: CalendarEventItem[] };
  return body.items || [];
}

export async function listPrimaryCalendarEvents(
  accessToken: string,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {}
): Promise<CalendarEventItem[]> {
  return listCalendarEvents(accessToken, "primary", opts);
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: {
    recruiterEmail: string;
    companyName: string;
    title?: string;
    notes?: string;
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
    /** Extra invitees (e.g. admin mailbox) when Meet is hosted on a dedicated calendar. */
    extraAttendeeEmails?: string[];
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
  add("fred@fireflies.ai");
  for (const email of input.extraAttendeeEmails ?? []) {
    add(email);
  }

  const payload = {
    summary: input.title?.trim() || `Placement Meeting - ${input.companyName}`,
    description: input.notes?.trim() || `Placement office recruiter meeting with ${input.companyName}.`,
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
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  let res: Response;
  try {
    const cal = encodeURIComponent(calendarId.trim() || "primary");
    res = await fetch(`${CALENDAR_API}/calendars/${cal}/events?conferenceDataVersion=1`, {
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

/** Creates an event on the signed-in user's primary calendar. */
export async function createPrimaryCalendarEvent(
  accessToken: string,
  input: Parameters<typeof createCalendarEvent>[2]
): Promise<CalendarEventItem> {
  return createCalendarEvent(accessToken, "primary", input);
}
