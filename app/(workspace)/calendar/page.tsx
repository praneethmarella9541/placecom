"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateSelectArg } from "@fullcalendar/core";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatCalendarDateTime } from "@/lib/utils";
import { IconCalendar, IconPlus, IconRefresh, IconX } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

type EventRow = {
  id: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
};

type RecruiterRow = {
  email: string;
  name: string;
  companyName: string;
  source: string;
};

function parseEventInstant(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function eventEndMs(e: EventRow): number | null {
  return parseEventInstant(e.end?.dateTime || e.end?.date);
}

function eventStartMs(e: EventRow): number | null {
  return parseEventInstant(e.start?.dateTime || e.start?.date);
}

/** Event has not ended yet (includes meetings in progress). */
function isEventStillUpcoming(e: EventRow, now: number): boolean {
  const end = eventEndMs(e);
  if (end !== null) return end >= now;
  const start = eventStartMs(e);
  if (start !== null) return start >= now;
  return false;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [loadingRecruiters, setLoadingRecruiters] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [rangeStartIso, setRangeStartIso] = useState<string | null>(null);
  const [rangeEndIso, setRangeEndIso] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);

  const loadRecruiters = useCallback(async () => {
    setLoadingRecruiters(true);
    setError(null);
    try {
      const recruiterRes = await fetch("/api/recruiters");
      const rcJson = (await recruiterRes.json()) as {
        recruiters?: RecruiterRow[];
        error?: string;
      };
      if (!recruiterRes.ok) throw new Error(rcJson.error || "Failed to load recruiters");

      setRecruiters(rcJson.recruiters || []);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setLoadingRecruiters(false);
    }
  }, []);

  useEffect(() => {
    void loadRecruiters();
  }, [loadRecruiters]);

  const loadEvents = useCallback(async (timeMin?: string, timeMax?: string) => {
    setLoadingEvents(true);
    setError(null);
    try {
      const start = timeMin || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `/api/calendar/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&maxResults=500`
      );
      const body = (await res.json()) as { events?: EventRow[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load events");
      setEvents(body.events || []);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
  }, [loadEvents, rangeEndIso, rangeStartIso]);

  const calendarEvents = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        title: e.summary || "(untitled)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        url: e.htmlLink,
      })),
    [events]
  );

  /** Sidebar list: only future / in-progress — not everything in the calendar fetch window (which includes past days). */
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => isEventStillUpcoming(e, now))
      .sort((a, b) => (eventStartMs(a) ?? 0) - (eventStartMs(b) ?? 0));
  }, [events]);

  function toInputValue(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  function onDateSelect(arg: DateSelectArg) {
    setStartDateTime(toInputValue(arg.start));
    setEndDateTime(toInputValue(arg.end));
    setModalOpen(true);
  }

  async function scheduleMeeting() {
    if (!recruiterEmail || !companyName || !startDateTime || !endDateTime) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiterEmail,
          companyName,
          title,
          notes,
          startDateTime: new Date(startDateTime).toISOString(),
          endDateTime: new Date(endDateTime).toISOString(),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to schedule meeting");
      setModalOpen(false);
      await loadRecruiters();
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {titleCase("Calendar")}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void loadRecruiters();
              void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
            }}
            className="btn-ghost"
          >
            <IconRefresh className="h-4 w-4" /> {titleCase("Refresh")}
          </button>
          <button type="button" onClick={() => setModalOpen(true)} className="btn-primary">
            <IconPlus className="h-4 w-4" /> {titleCase("Schedule meeting")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {titleCase("Calendar (in-app)")}
          </h2>
          <span className="text-xs text-zinc-500">
            {titleCase("Select a slot to schedule meeting")}
          </span>
        </div>
        <div className="calendar-surface overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "timeGridWeek,timeGridDay,dayGridMonth",
            }}
            allDayText="All day"
            selectable
            selectMirror
            select={onDateSelect}
            events={calendarEvents}
            eventClick={(arg) => {
              arg.jsEvent.preventDefault();
              const match = events.find((e) => e.id === arg.event.id);
              if (match) setSelectedEvent(match);
            }}
            datesSet={(arg) => {
              setRangeStartIso(arg.start.toISOString());
              setRangeEndIso(arg.end.toISOString());
            }}
            height="auto"
            contentHeight={560}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {titleCase(
            "Events are synced from your primary Google Calendar. Creating a meeting here writes directly to Google Calendar."
          )}
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {titleCase("Upcoming events")}
        </h2>
        {loadingEvents ? (
          <p className="text-sm text-zinc-500">{titleCase("Loading events...")}</p>
        ) : events.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <IconCalendar className="h-4 w-4" /> {titleCase("No events in selected range.")}
          </div>
        ) : upcomingEvents.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <IconCalendar className="h-4 w-4" />{" "}
            {titleCase("No upcoming events in this view — the visible range only includes past events.")}
          </div>
        ) : (
          <ul className="space-y-2">
            {upcomingEvents.slice(0, 20).map((e) => (
              <li key={e.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="font-medium text-zinc-900 dark:text-zinc-100">{e.summary || "(untitled)"}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatCalendarDateTime(e.start?.dateTime || e.start?.date || "")} —{" "}
                  {formatCalendarDateTime(e.end?.dateTime || e.end?.date || "")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center">
          <div className="card w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {titleCase("Schedule meeting")}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <input
                  list="recruiter-emails"
                  type="email"
                  placeholder={titleCase("Recruiter email")}
                  value={recruiterEmail}
                  onChange={(e) => {
                    const email = e.target.value;
                    setRecruiterEmail(email);
                    const match = recruiters.find((r) => r.email === email);
                    if (match && !companyName) setCompanyName(match.companyName);
                  }}
                  className="input-field"
                />
                <datalist id="recruiter-emails">
                  {recruiters.map((r) => (
                    <option key={r.email} value={r.email}>
                      {r.name} - {r.companyName} ({r.source})
                    </option>
                  ))}
                </datalist>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {loadingRecruiters
                    ? titleCase("Loading recruiter suggestions...")
                    : titleCase(
                        "Suggestions use extracted contacts (internal data). Lusha/scraped sources can pass email here too."
                      )}
                </p>
              </div>
              <input
                type="text"
                placeholder={titleCase("Company name")}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="input-field"
              />
              <input
                type="text"
                placeholder={titleCase("Meeting title (optional)")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="datetime-local" value={startDateTime} onChange={(e) => setStartDateTime(e.target.value)} className="input-field" />
                <input type="datetime-local" value={endDateTime} onChange={(e) => setEndDateTime(e.target.value)} className="input-field" />
              </div>
              <textarea
                rows={4}
                placeholder={titleCase("Notes (optional)")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-field resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-ghost">
                {titleCase("Cancel")}
              </button>
              <button type="button" disabled={busy} onClick={() => void scheduleMeeting()} className="btn-primary">
                {busy ? titleCase("Scheduling...") : titleCase("Create event")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center">
          <div className="card w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {titleCase("Meeting details")}
              </h3>
              <button type="button" onClick={() => setSelectedEvent(null)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="text-xs tracking-wide text-zinc-500">{titleCase("Title")}</p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {selectedEvent.summary || "(untitled)"}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs tracking-wide text-zinc-500">{titleCase("Start")}</p>
                  <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                    {formatCalendarDateTime(selectedEvent.start?.dateTime || selectedEvent.start?.date || "")}
                  </p>
                </div>
                <div>
                  <p className="text-xs tracking-wide text-zinc-500">{titleCase("End")}</p>
                  <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                    {formatCalendarDateTime(selectedEvent.end?.dateTime || selectedEvent.end?.date || "")}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs tracking-wide text-zinc-500">{titleCase("Status")}</p>
                <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                  {titleCase((selectedEvent.status || "confirmed").replace(/-/g, " "))}
                </p>
              </div>
              <div>
                <p className="text-xs tracking-wide text-zinc-500">{titleCase("Location")}</p>
                <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                  {selectedEvent.location || titleCase("Not specified")}
                </p>
              </div>
              <div>
                <p className="text-xs tracking-wide text-zinc-500">{titleCase("Attendees")}</p>
                <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                  {selectedEvent.attendees?.length
                    ? selectedEvent.attendees.map((a) => a.email).filter(Boolean).join(", ")
                    : titleCase("No attendees listed")}
                </p>
              </div>
              <div>
                <p className="text-xs tracking-wide text-zinc-500">{titleCase("Notes")}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                  {selectedEvent.description || titleCase("No description")}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setSelectedEvent(null)} className="btn-ghost">
                {titleCase("Close")}
              </button>
              <div className="flex gap-2">
                {selectedEvent.hangoutLink ? (
                  <a
                    href={selectedEvent.hangoutLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary"
                  >
                    {titleCase("Join meeting")}
                  </a>
                ) : null}
                {selectedEvent.htmlLink ? (
                  <a
                    href={selectedEvent.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                  >
                    {titleCase("Open in Google Calendar")}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
