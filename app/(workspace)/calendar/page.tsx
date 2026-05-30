"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatCalendarDateTime } from "@/lib/utils";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from "@/components/Icons";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import {
  RECURRENCE_OPTIONS,
  buildRecurrenceRules,
  formatRecurrenceLabel,
  parseRecurrencePreset,
  type RecurrencePreset,
} from "@/lib/calendar-recurrence";
import { CalendarFreeBusyPanel } from "@/components/CalendarFreeBusyPanel";
import { CalendarRsvpButtons, type RsvpStatus } from "@/components/CalendarRsvpButtons";

/* ─── Types ─────────────────────────────────────────────────── */
type Attendee = {
  email?: string;
  displayName?: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction" | string;
  organizer?: boolean;
  self?: boolean;
};

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
  attendees?: Attendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  recurrence?: string[];
  recurringEventId?: string;
};

type RecruiterRow = {
  email: string;
  name: string;
  companyName: string;
  source: string;
};

type SendUpdates = "all" | "externalOnly" | "none";

type ViewType = "timeGridWeek" | "timeGridDay" | "dayGridMonth";

/* ─── Helpers ───────────────────────────────────────────────── */
const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function parseMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function eventStartMs(e: EventRow): number | null {
  return parseMs(e.start?.dateTime || e.start?.date);
}

function eventEndMs(e: EventRow): number | null {
  return parseMs(e.end?.dateTime || e.end?.date);
}

function isUpcoming(e: EventRow, now: number): boolean {
  const end = eventEndMs(e);
  if (end !== null) return end >= now;
  const start = eventStartMs(e);
  return start !== null ? start >= now : false;
}

function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Returns array of day-of-month values for a 6×7 mini calendar grid.
 *  null = days spilling from prev/next month (greyed out). */
function buildMiniGrid(year: number, month: number): (null | { d: number; month: number; year: number })[] {
  const first = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells: (null | { d: number; month: number; year: number })[] = [];

  for (let i = first - 1; i >= 0; i--) {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    cells.push({ d: prevMonthDays - i, month: prevMonth, year: prevYear });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d, month, year });
  }
  const remaining = 42 - cells.length;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ d, month: nextMonth, year: nextYear });
  }
  return cells;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const USER_TZ =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "Asia/Kolkata";

function defaultMeetingTimes(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { start: toInputValue(start), end: toInputValue(end) };
}

function applyDurationFromStart(startStr: string, minutes: number): string {
  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return "";
  return toInputValue(new Date(start.getTime() + minutes * 60_000));
}

/** Scroll the time grid to ~30 min before now (Google Calendar behaviour). */
function scrollTimeNearNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function isAllDayEvent(ev: EventRow): boolean {
  return !ev.start?.dateTime && !!ev.start?.date;
}

function eventMatchesSearch(ev: EventRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    ev.summary,
    ev.description,
    ev.location,
    ...(ev.attendees ?? []).flatMap((a) => [a.email, a.displayName]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

/* ─── Sub-components ────────────────────────────────────────── */

/** Google-Calendar-style mini month picker in the left rail. */
function MiniMonthPicker({
  viewDate,
  onSelectDay,
}: {
  viewDate: Date;
  onSelectDay: (d: Date) => void;
}) {
  const today = new Date();
  const [navYear, setNavYear] = useState(viewDate.getFullYear());
  const [navMonth, setNavMonth] = useState(viewDate.getMonth());

  // Keep nav in sync when the main calendar navigates
  useEffect(() => {
    setNavYear(viewDate.getFullYear());
    setNavMonth(viewDate.getMonth());
  }, [viewDate]);

  const grid = buildMiniGrid(navYear, navMonth);

  function prev() {
    if (navMonth === 0) { setNavYear(y => y - 1); setNavMonth(11); }
    else setNavMonth(m => m - 1);
  }
  function next() {
    if (navMonth === 11) { setNavYear(y => y + 1); setNavMonth(0); }
    else setNavMonth(m => m + 1);
  }

  return (
    <div className="px-3 pt-2 pb-1">
      {/* month/year header */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-text)]">
          {MONTHS[navMonth]} {navYear}
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={prev}
            className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
          >
            <IconChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={next}
            className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
          >
            <IconChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* day-of-week headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {DAYS_SHORT.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-[var(--color-text-faint)] py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* day cells */}
      <div className="grid grid-cols-7">
        {grid.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const cellDate = new Date(cell.year, cell.month, cell.d);
          const isCurrent = cell.month === navMonth;
          const isToday = sameDay(cellDate, today);
          const isSelected = sameDay(cellDate, viewDate);

          return (
            <button
              key={i}
              onClick={() => onSelectDay(cellDate)}
              className={[
                "flex items-center justify-center rounded-full w-7 h-7 mx-auto my-0.5",
                "text-[11px] transition-colors",
                isToday && !isSelected
                  ? "font-bold text-[var(--color-primary)]"
                  : "",
                isSelected
                  ? "bg-[var(--color-primary)] text-white font-bold"
                  : isCurrent
                  ? "text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
                  : "text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)]",
              ].join(" ")}
            >
              {cell.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mini agenda — next N upcoming events in the left rail. */
function MiniAgenda({ events, onSelect }: { events: EventRow[]; onSelect: (e: EventRow) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => isUpcoming(e, now))
        .sort((a, b) => (eventStartMs(a) ?? 0) - (eventStartMs(b) ?? 0))
        .slice(0, 8),
    [events, now]
  );

  if (upcoming.length === 0) return null;

  return (
    <div className="px-3 pt-3 pb-2 border-t border-[var(--color-border)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
        Upcoming
      </p>
      <ul className="space-y-1.5">
        {upcoming.map((e) => {
          const start = eventStartMs(e);
          const startDate = start ? new Date(start) : null;
          const timeStr = startDate
            ? startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : "";
          const dateStr = startDate
            ? startDate.toLocaleDateString([], { month: "short", day: "numeric" })
            : "";
          return (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e)}
                className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-offset)] transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)] mt-1" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-[var(--color-text)] leading-tight">
                      {e.summary || "(untitled)"}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-faint)]">
                      {dateStr} {timeStr}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────── */
export default function CalendarPage() {
  const calendarRef = useRef<FullCalendar>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [loadingRecruiters, setLoadingRecruiters] = useState(true);
  // Google contacts — merged with recruiters to power the same
  // autocomplete used by the Compose mail modal.
  const [googleContacts, setGoogleContacts] = useState<RecipientSuggestion[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarSearch, setCalendarSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  // View state
  const [currentView, setCurrentView] = useState<ViewType>("timeGridWeek");
  const [viewDate, setViewDate] = useState(new Date());
  const [viewTitle, setViewTitle] = useState("");
  const [rangeStartIso, setRangeStartIso] = useState<string | null>(null);
  const [rangeEndIso, setRangeEndIso] = useState<string | null>(null);

  // Modals
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);

  // Create form fields
  const [busy, setBusy] = useState(false);
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [addMeet, setAddMeet] = useState(true);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("none");

  // Signed-in user emails — for in-app RSVP matching
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [mailboxEmail, setMailboxEmail] = useState<string | null>(null);

  // Edit form fields
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
  const [editAddMeet, setEditAddMeet] = useState(false);
  const [editAttendees, setEditAttendees] = useState(""); // comma-sep emails
  const [editNotify, setEditNotify] = useState<SendUpdates>("all");
  const [editRecurrencePreset, setEditRecurrencePreset] = useState<RecurrencePreset>("none");
  const [editIsSeriesInstance, setEditIsSeriesInstance] = useState(false);
  // Success state — shown after meeting created
  const [createdMeetLink, setCreatedMeetLink] = useState<string | null>(null);

  /* ── Data loading ────────────────────────────────────── */
  const loadRecruiters = useCallback(async () => {
    setLoadingRecruiters(true);
    try {
      const res = await fetch("/api/recruiters");
      const json = (await res.json()) as { recruiters?: RecruiterRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load recruiters");
      setRecruiters(json.recruiters || []);
    } catch {
      // Non-fatal — contacts still power suggestions.
    } finally {
      setLoadingRecruiters(false);
    }
  }, []);

  const loadEvents = useCallback(async (timeMin?: string, timeMax?: string) => {
    setLoadingEvents(true);
    setError(null);
    try {
      const start = timeMin || new Date(Date.now() - 30 * 86400000).toISOString();
      const end = timeMax || new Date(Date.now() + 90 * 86400000).toISOString();
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

  useEffect(() => { void loadRecruiters(); }, [loadRecruiters]);

  useEffect(() => {
    fetch("/api/me/mailbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const data = j as { sessionEmail?: string | null; mailboxEmail?: string | null } | null;
        if (data?.sessionEmail) setSessionEmail(data.sessionEmail.trim().toLowerCase());
        if (data?.mailboxEmail) setMailboxEmail(data.mailboxEmail.trim().toLowerCase());
      })
      .catch(() => {});
  }, []);

  // Pull Google contacts once on mount — same source the Compose modal uses,
  // so the meeting recipient pickers feel consistent with the mail flow.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gmail/contacts")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const contacts = (j as { contacts?: RecipientSuggestion[] } | null)?.contacts;
        if (Array.isArray(contacts)) setGoogleContacts(contacts);
      })
      .catch(() => {/* non-fatal — recruiters still work */});
    return () => { cancelled = true; };
  }, []);

  // Merge recruiters + Google contacts into the suggestion list shape that
  // RecipientField expects. Email is the dedup key; the first encountered
  // displayName wins (contacts have richer names than recruiters typically).
  const recipientSuggestions = useMemo((): RecipientSuggestion[] => {
    const map = new Map<string, string>();
    for (const c of googleContacts) {
      const em = c.email.trim().toLowerCase();
      if (em) map.set(em, c.displayName?.trim() || em);
    }
    for (const r of recruiters) {
      const em = r.email.trim().toLowerCase();
      if (em && !map.has(em)) map.set(em, r.name.trim() || em);
    }
    return Array.from(map.entries()).map(([email, label]) => ({
      email,
      displayName: label !== email ? label : undefined,
    }));
  }, [googleContacts, recruiters]);
  useEffect(() => {
    void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
  }, [loadEvents, rangeStartIso, rangeEndIso]);

  /* ── Calendar API helpers ────────────────────────────── */
  const getApi = () => calendarRef.current?.getApi();

  function goView(v: ViewType) {
    setCurrentView(v);
    getApi()?.changeView(v);
  }

  function goPrev() { getApi()?.prev(); }
  function goNext() { getApi()?.next(); }
  function goToday() { getApi()?.today(); }

  function navigateToDay(d: Date) {
    const api = getApi();
    if (!api) return;
    api.gotoDate(d);
    if (currentView === "timeGridWeek") {
      // stay in week view — just jump to that week
    } else if (currentView === "dayGridMonth") {
      // stay in month
    } else {
      api.changeView("timeGridDay");
      setCurrentView("timeGridDay");
    }
  }

  function openScheduleModal(prefill?: { start?: string; end?: string }) {
    const defaults = defaultMeetingTimes();
    setStartDateTime(prefill?.start ?? defaults.start);
    setEndDateTime(prefill?.end ?? defaults.end);
    setRecurrencePreset("none");
    setScheduleError(null);
    setScheduleOpen(true);
  }

  function findSelfAttendee(ev: EventRow): Attendee | undefined {
    const emails = new Set(
      [sessionEmail, mailboxEmail].filter(Boolean) as string[]
    );
    return (ev.attendees ?? []).find((a) => {
      if (a.self) return !a.organizer;
      const em = a.email?.trim().toLowerCase();
      return em ? emails.has(em) && !a.organizer : false;
    });
  }

  function canRsvp(ev: EventRow): boolean {
    return !!findSelfAttendee(ev);
  }

  function applyRsvpToEvent(ev: EventRow, status: RsvpStatus): EventRow {
    const self = findSelfAttendee(ev);
    if (!self?.email) return ev;
    const target = self.email.toLowerCase();
    return {
      ...ev,
      attendees: (ev.attendees ?? []).map((a) =>
        a.email?.toLowerCase() === target ? { ...a, responseStatus: status } : a
      ),
    };
  }

  function onRsvpUpdated(ev: EventRow, status: RsvpStatus) {
    const updated = applyRsvpToEvent(ev, status);
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, ...updated } : e)));
    setSelectedEvent((cur) => (cur?.id === ev.id ? { ...cur, ...updated } : cur));
  }

  function onDateSelect(arg: DateSelectArg) {
    openScheduleModal({
      start: toInputValue(arg.start),
      end: toInputValue(arg.end),
    });
  }

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    const match = events.find((e) => e.id === arg.event.id);
    if (match) setSelectedEvent(match);
  }

  const filteredEvents = useMemo(
    () => events.filter((e) => eventMatchesSearch(e, calendarSearch)),
    [events, calendarSearch]
  );

  /* ── FullCalendar events ─────────────────────────────── */
  const calendarEvents = useMemo(
    () =>
      filteredEvents.map((e) => ({
        id: e.id,
        title: `${e.recurrence?.length || e.recurringEventId ? "↻ " : ""}${e.summary || "(untitled)"}`,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        url: "",
        allDay: !e.start?.dateTime,
        editable: !isAllDayEvent(e),
      })),
    [filteredEvents]
  );

  /* ── Schedule meeting (create) ───────────────────────── */
  async function scheduleMeeting() {
    const allEmails = extractAllEmailsFromText(recruiterEmail);
    const primary = allEmails[0];
    const extras = allEmails.slice(1);
    if (!primary || !title || !startDateTime || !endDateTime) {
      setScheduleError("Fill in title, guests, and start/end times.");
      return;
    }
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      setScheduleError("End time must be after start time.");
      return;
    }
    setBusy(true);
    setScheduleError(null);
    setError(null);
    try {
      const res = await fetch("/api/calendar/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiterEmail: primary,
          title,
          notes,
          location: location.trim() || undefined,
          timeZone: USER_TZ,
          startDateTime: new Date(startDateTime).toISOString(),
          endDateTime: new Date(endDateTime).toISOString(),
          recurrence: buildRecurrenceRules(recurrencePreset),
          addMeet,
          sendUpdates: "all",
          extraAttendeeEmails: extras.length ? extras : undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        event?: { hangoutLink?: string; htmlLink?: string };
      };
      if (!res.ok) throw new Error(body.error || "Failed to schedule meeting");

      const meetLink = body.event?.hangoutLink ?? null;
      setCreatedMeetLink(meetLink);
      setScheduleOpen(false);
      setRecruiterEmail("");
      setTitle("");
      setNotes("");
      setLocation("");
      await loadRecruiters();
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setScheduleError(clientFetchFailedMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ── Open edit modal pre-filled ──────────────────────── */
  function openEdit(ev: EventRow) {
    setEditEvent(ev);
    setEditTitle(ev.summary || "");
    setEditNotes(ev.description || "");
    setEditLocation(ev.location || "");
    const allDay = isAllDayEvent(ev);
    setEditAllDay(allDay);
    setEditStart(
      allDay
        ? ev.start?.date || ""
        : ev.start?.dateTime
          ? toInputValue(new Date(ev.start.dateTime))
          : ""
    );
    setEditEnd(
      allDay
        ? ev.end?.date || ""
        : ev.end?.dateTime
          ? toInputValue(new Date(ev.end.dateTime))
          : ""
    );
    setEditAttendees((ev.attendees ?? []).map((a) => a.email).filter(Boolean).join(", "));
    setEditAddMeet(!ev.hangoutLink);
    setEditRecurrencePreset(parseRecurrencePreset(ev.recurrence));
    setEditIsSeriesInstance(!!ev.recurringEventId && ev.recurringEventId !== ev.id);
    setEditNotify("all");
    setEditError(null);
    setSelectedEvent(null);
  }

  /* ── Cancel / delete a scheduled event ──────────────────
   *
   * Two-step flow matching Gmail's "Delete with note" UX:
   *   1. User clicks Delete → we open the confirm modal with an optional
   *      "Add a note to attendees" textarea.
   *   2. User clicks Delete in the modal → we DELETE the event with
   *      sendUpdates=all (Google sends its standard cancellation email),
   *      then if a note was provided we also send a separate follow-up
   *      email via Gmail to all attendees with the user's reason.
   */
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [deleteNote, setDeleteNote] = useState("");

  function openDeleteConfirm(ev: EventRow) {
    setDeleteTarget(ev);
    setDeleteNote("");
  }

  /** Send a follow-up email to a meeting's attendees explaining a change
   *  or cancellation. No-op if there are no attendees or the note is empty. */
  async function sendAttendeeNote(
    ev: EventRow,
    note: string,
    kind: "cancelled" | "updated"
  ): Promise<void> {
    const recipients = (ev.attendees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (recipients.length === 0 || !note.trim()) return;
    const verb = kind === "cancelled" ? "Cancelled" : "Updated";
    const subject = `${verb}: ${ev.summary || "(untitled meeting)"}`;
    const lines = [
      kind === "cancelled"
        ? `The meeting "${ev.summary || "(untitled meeting)"}" has been cancelled.`
        : `The meeting "${ev.summary || "(untitled meeting)"}" has been updated.`,
      "",
      "Note from the organizer:",
      note.trim(),
    ];
    try {
      await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipients.join(", "),
          subject,
          textBody: lines.join("\n"),
        }),
      });
    } catch {
      // Non-fatal — the event was already cancelled / updated server-side.
    }
  }

  async function confirmDelete() {
    const ev = deleteTarget;
    if (!ev) return;
    const hasGuests = (ev.attendees?.length ?? 0) > 0;
    setDeleteBusy(true);
    try {
      // sendUpdates=all so Google emails the cancellation to attendees,
      // matching what Gmail/Calendar does when you delete from their UI.
      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(ev.id)}?sendUpdates=${hasGuests ? "all" : "none"}`,
        { method: "DELETE" }
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to delete event");
      // Optional follow-up email with the user's note. Fired-and-forget so
      // a hiccup doesn't block the UI from closing.
      if (deleteNote.trim() && hasGuests) {
        void sendAttendeeNote(ev, deleteNote, "cancelled");
      }
      // Close any open detail / edit / delete views referencing this event
      setSelectedEvent(null);
      setEditEvent(null);
      setDeleteTarget(null);
      setDeleteNote("");
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      alert(clientFetchFailedMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  /* ── Save edits ──────────────────────────────────────── */
  async function saveEdit() {
    if (!editEvent || !editTitle || !editStart || !editEnd) return;
    if (!editAllDay && new Date(editEnd) <= new Date(editStart)) {
      setEditError("End time must be after start time.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const attendees = extractAllEmailsFromText(editAttendees).map((email) => ({ email }));
      const start = editAllDay
        ? editEvent.start?.date
          ? { date: editEvent.start.date }
          : undefined
        : { dateTime: new Date(editStart).toISOString(), timeZone: USER_TZ };
      const end = editAllDay
        ? editEvent.end?.date
          ? { date: editEvent.end.date }
          : undefined
        : { dateTime: new Date(editEnd).toISOString(), timeZone: USER_TZ };

      const res = await fetch(`/api/calendar/events/${encodeURIComponent(editEvent.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: editTitle,
          description: editNotes || undefined,
          location: editLocation.trim() || undefined,
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
          attendees: attendees.length ? attendees : undefined,
          addMeet: editAddMeet && !editEvent.hangoutLink ? true : undefined,
          sendUpdates: editNotify,
          ...(editIsSeriesInstance
            ? {}
            : {
                recurrence:
                  editRecurrencePreset === "none"
                    ? []
                    : buildRecurrenceRules(editRecurrencePreset),
              }),
        }),
      });
      const body = (await res.json()) as { error?: string; event?: EventRow };
      if (!res.ok) throw new Error(body.error || "Failed to update event");
      setEditEvent(null);
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setEditError(clientFetchFailedMessage(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    setSyncing(false);
  }

  /** Drag or resize on the grid — PATCH new times (Google Calendar behaviour). */
  async function rescheduleEvent(
    eventId: string,
    start: Date,
    end: Date,
    revert: () => void
  ) {
    try {
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { dateTime: start.toISOString(), timeZone: USER_TZ },
          end: { dateTime: end.toISOString(), timeZone: USER_TZ },
          sendUpdates: "all",
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to reschedule");
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      revert();
      alert(clientFetchFailedMessage(e));
    }
  }

  function onEventDrop(arg: EventDropArg) {
    if (!arg.event.start || !arg.event.end) {
      arg.revert();
      return;
    }
    void rescheduleEvent(arg.event.id, arg.event.start, arg.event.end, arg.revert);
  }

  function onEventResize(arg: EventResizeDoneArg) {
    if (!arg.event.start || !arg.event.end) {
      arg.revert();
      return;
    }
    void rescheduleEvent(arg.event.id, arg.event.start, arg.event.end, arg.revert);
  }

  useEffect(() => {
    if (!createdMeetLink) return;
    const t = setTimeout(() => setCreatedMeetLink(null), 12_000);
    return () => clearTimeout(t);
  }, [createdMeetLink]);

  /* ── Deep-link from inbox invite buttons ─────────────────
   *
   * The inbox view routes here with ?eventId=...&action=edit|delete after
   * the user clicks the inline Edit / Delete button on a calendar invite
   * email. Once the events list has loaded we find the matching event and
   * auto-open the corresponding modal. The URL is then cleared so a
   * refresh doesn't re-trigger the action.
   */
  const handledDeepLinkRef = useRef(false);
  useEffect(() => {
    if (handledDeepLinkRef.current) return;
    const eventId = searchParams.get("eventId");
    const action = searchParams.get("action");
    if (!eventId || (action !== "edit" && action !== "delete")) return;

    async function resolveDeepLink() {
      let match = events.find((e) => e.id === eventId);
      if (!match && !loadingEvents) {
        try {
          const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId!)}`);
          const body = (await res.json()) as { event?: EventRow; error?: string };
          if (res.ok && body.event) {
            match = body.event;
            setEvents((prev) =>
              prev.some((e) => e.id === match!.id) ? prev : [...prev, match!]
            );
          }
        } catch {
          /* fall through */
        }
      }
      if (loadingEvents && !match) return;

      if (!match) {
        handledDeepLinkRef.current = true;
        router.replace("/calendar");
        alert("Could not find that meeting. It may have been deleted.");
        return;
      }
      handledDeepLinkRef.current = true;
      if (action === "edit") openEdit(match);
      else openDeleteConfirm(match);
      router.replace("/calendar");
    }

    void resolveDeepLink();
  }, [events, loadingEvents, searchParams, router]);

  const scheduleGuestEmails = useMemo(
    () => extractAllEmailsFromText(recruiterEmail),
    [recruiterEmail]
  );

  const scheduleStartIso = startDateTime ? new Date(startDateTime).toISOString() : null;
  const scheduleEndIso = endDateTime ? new Date(endDateTime).toISOString() : null;

  const editGuestEmails = useMemo(
    () => extractAllEmailsFromText(editAttendees),
    [editAttendees]
  );

  const editStartIso =
    editStart && !editAllDay ? new Date(editStart).toISOString() : null;
  const editEndIso = editEnd && !editAllDay ? new Date(editEnd).toISOString() : null;

  /* ── Render ──────────────────────────────────────────── */
  return (
    <>
      {/* ── Google-Calendar CSS overrides injected here ── */}
      <style>{`
        /* Wrapper */
        .gc-surface { display: flex; flex-direction: column; height: 100%; }

        /* ── Toolbar ── */
        .gc-surface .fc-toolbar { display: none !important; }

        /* ── Header row (day names) ── */
        .gc-surface .fc-col-header-cell { border: none !important; padding: 0 !important; }
        .gc-surface .fc-col-header-cell-cushion {
          display: flex; flex-direction: column; align-items: center;
          padding: 8px 4px 4px; gap: 2px;
          text-decoration: none !important; color: var(--color-text-muted) !important;
          font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase;
        }
        .gc-surface .fc-col-header-cell.fc-day-today .fc-col-header-cell-cushion {
          color: var(--color-primary) !important;
        }

        /* Today "circle" on day number in week view */
        .gc-surface .fc-col-header-cell.fc-day-today .gc-day-num {
          background: var(--color-primary);
          color: white;
          border-radius: 50%;
          width: 26px; height: 26px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 13px;
        }
        .gc-surface .gc-day-num {
          font-size: 13px; font-weight: 600; color: var(--color-text);
          width: 26px; height: 26px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%;
        }

        /* ── Table borders ── */
        .gc-surface .fc-theme-standard td,
        .gc-surface .fc-theme-standard th {
          border-color: var(--color-border) !important;
        }
        .gc-surface .fc-scrollgrid { border: none !important; }
        .gc-surface .fc-scrollgrid-section > td { border: none !important; }
        .gc-surface .fc-scrollgrid-sync-table { border-bottom: none !important; }

        /* ── Time column ── */
        .gc-surface .fc-timegrid-axis { border: none !important; }
        .gc-surface .fc-timegrid-slot-label-cushion {
          font-size: 10px; color: var(--color-text-faint);
          padding-right: 8px; font-weight: 500;
          text-transform: uppercase; letter-spacing: .04em;
        }
        .gc-surface .fc-timegrid-slot { height: 48px !important; }
        .gc-surface .fc-timegrid-slot-minor { border-top-style: dotted !important; opacity: .5; }

        /* ── FullCalendar CSS variables — must be set for overlap shadows ── */
        .gc-surface {
          --fc-page-bg-color: var(--color-surface);
          --fc-today-bg-color: rgba(79, 70, 229, 0.04);
          --fc-now-indicator-color: #ea4335;
          --fc-small-font-size: 11px;
          --fc-border-color: var(--color-border);
        }

        /* ── Event harness — DO NOT override position/size, FC sets those ── */
        /* Only style the inner .fc-timegrid-event, not the harness wrapper   */
        .gc-surface .fc-timegrid-event {
          border-radius: 4px !important;
          border: none !important;
          background: var(--color-primary) !important;
          color: white !important;
          font-size: 11px !important;
          padding: 2px 4px !important;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(0,0,0,.18);
          transition: filter .15s;
          overflow: hidden;
        }
        .gc-surface .fc-timegrid-event:hover { filter: brightness(1.1); }

        /* Inset (overlapping) events get a white border so they visually separate */
        .gc-surface .fc-timegrid-event-harness-inset .fc-timegrid-event {
          box-shadow: inset 0 0 0 1.5px var(--color-surface), 0 1px 2px rgba(0,0,0,.18) !important;
        }

        /* Generic .fc-event (covers daygrid month view + any other context) */
        .gc-surface .fc-event:not(.fc-timegrid-event) {
          border-radius: 4px !important;
          border: none !important;
          background: var(--color-primary) !important;
          color: white !important;
          font-size: 11px !important;
          cursor: pointer;
        }
        .gc-surface .fc-event-title { font-weight: 600 !important; }
        .gc-surface .fc-event-time { opacity: .85 !important; font-size: 10px !important; }

        /* All-day events */
        .gc-surface .fc-daygrid-event {
          border-radius: 4px !important;
          border: none !important;
          background: var(--color-primary) !important;
          color: white !important;
          font-size: 11px !important;
          margin: 1px 2px !important;
        }
        .gc-surface .fc-daygrid-event-dot { display: none !important; }

        /* All-day row */
        .gc-surface .fc-timegrid-axis-cushion { font-size: 9px !important; text-transform: uppercase; }
        .gc-surface .fc-timegrid-all-day .fc-daygrid-event { margin: 2px !important; }

        /* ── Current time indicator (Google Calendar: dot + horizontal line) ── */
        .gc-surface .fc-timegrid-axis-chunk,
        .gc-surface .fc-timegrid-cols,
        .gc-surface .fc-timegrid-col-frame,
        .gc-surface .fc-timegrid-now-indicator-container {
          overflow: visible !important;
        }
        .gc-surface .fc-timegrid-now-indicator-arrow {
          display: none !important;
        }
        .gc-surface .fc-timegrid-now-indicator-line {
          border: none !important;
          border-top: 2px solid #ea4335 !important;
          left: 0 !important;
          right: 0 !important;
          width: auto !important;
          z-index: 4 !important;
          pointer-events: none;
        }
        .gc-surface .fc-timegrid-now-indicator-line::before {
          content: "";
          position: absolute;
          left: -6px;
          top: -6px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ea4335;
          box-shadow: 0 0 0 2px var(--color-surface);
        }

        /* ── Today column — color via --fc-today-bg-color ── */

        /* ── Month view ── */
        .gc-surface .fc-daygrid-day-number {
          font-size: 12px; color: var(--color-text-muted);
          font-weight: 500; padding: 4px 6px;
          border-radius: 50%; width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          text-decoration: none !important;
        }
        .gc-surface .fc-day-today .fc-daygrid-day-number {
          background: var(--color-primary); color: white; font-weight: 700;
        }
        .gc-surface .fc-daygrid-day { min-height: 80px !important; }

        /* ── Select mirror ── */
        .gc-surface .fc-highlight {
          background: rgba(79, 70, 229, 0.12) !important;
          border-radius: 4px !important;
        }

        /* ── Month: more link ── */
        .gc-surface .fc-daygrid-more-link {
          font-size: 11px; color: var(--color-text-muted); font-weight: 500;
        }

        /* scrollbar */
        .gc-surface .fc-scroller::-webkit-scrollbar { width: 6px; }
        .gc-surface .fc-scroller::-webkit-scrollbar-thumb {
          background: var(--color-border-strong); border-radius: 3px;
        }
      `}</style>

      {/* ── Full-bleed master layout ───────────────────── */}
      <div className="-mx-4 -mt-[calc(56px+16px)] -mb-6 flex h-[calc(100dvh-56px-24px)] min-h-0 overflow-hidden md:-mx-6 md:-mt-6 md:h-[calc(100dvh-48px)]">

        {/* ── Left rail ─────────────────────────────── */}
        <aside className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto">
          {/* "+ Create" button */}
          <div className="px-3 pt-4 pb-2">
            <button
              onClick={() => openScheduleModal()}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] shadow-sm hover:shadow-md transition-shadow"
            >
              <IconPlus className="h-5 w-5 text-[var(--color-primary)]" />
              Create
            </button>
          </div>

          {/* Mini month picker */}
          <MiniMonthPicker viewDate={viewDate} onSelectDay={navigateToDay} />

          {/* Mini agenda */}
          <MiniAgenda events={events} onSelect={setSelectedEvent} />
        </aside>

        {/* ── Right pane — calendar ─────────────────── */}
        <div className="flex flex-1 flex-col min-w-0 bg-[var(--color-surface)]">

          {/* ── Custom Google-Calendar-style toolbar ── */}
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
            {/* Mobile: "Create" button */}
            <button
              onClick={() => openScheduleModal()}
              className="md:hidden flex items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              <IconPlus className="h-3.5 w-3.5" /> Create
            </button>

            {/* Today + nav arrows */}
            <button
              onClick={goToday}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] transition-colors"
            >
              Today
            </button>
            <div className="flex gap-0.5">
              <button
                onClick={goPrev}
                className="rounded-full p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
              >
                <IconChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={goNext}
                className="rounded-full p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
              >
                <IconChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Title */}
            <h1 className="hidden sm:block flex-1 text-lg font-normal text-[var(--color-text)] truncate">
              {viewTitle}
            </h1>

            {/* Search — filter visible events like Google Calendar quick find */}
            <div className="relative flex-1 sm:max-w-[220px]">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
              <input
                type="search"
                value={calendarSearch}
                onChange={(e) => setCalendarSearch(e.target.value)}
                placeholder="Search events"
                className="input-field h-8 w-full pl-8 text-xs"
              />
            </div>

            <h1 className="sm:hidden flex-1 text-base font-normal text-[var(--color-text)] truncate">
              {viewTitle}
            </h1>

            {/* Error badge */}
            {error ? (
              <span className="max-w-[200px] truncate rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </span>
            ) : null}

            {/* Sync */}
            <button
              onClick={() => void handleSync()}
              disabled={syncing || loadingEvents}
              className="rounded-full p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors disabled:opacity-40"
              title="Refresh events"
            >
              <IconRefresh className={`h-4 w-4 ${syncing || loadingEvents ? "animate-spin" : ""}`} />
            </button>

            {/* View switcher */}
            <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
              {(
                [
                  { v: "timeGridDay" as ViewType, label: "Day" },
                  { v: "timeGridWeek" as ViewType, label: "Week" },
                  { v: "dayGridMonth" as ViewType, label: "Month" },
                ] as const
              ).map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => goView(v)}
                  className={[
                    "px-3 py-1 text-xs font-medium transition-colors",
                    currentView === v
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>

          {/* ── FullCalendar ──────────────────────────── */}
          <div className="flex-1 overflow-hidden gc-surface">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={currentView}
              headerToolbar={false}
              selectable
              selectMirror
              editable
              eventDrop={onEventDrop}
              eventResize={onEventResize}
              nowIndicator
              slotEventOverlap={true}
              eventOverlap={true}
              select={onDateSelect}
              eventClick={onEventClick}
              events={calendarEvents}
              height="100%"
              allDayText="All day"
              slotMinTime="00:00:00"
              slotMaxTime="24:00:00"
              scrollTime={scrollTimeNearNow()}
              scrollTimeReset={false}
              slotDuration="01:00:00"
              slotLabelInterval="01:00:00"
              slotLabelFormat={{
                hour: "numeric",
                minute: "2-digit",
                omitZeroMinute: true,
                meridiem: "short",
              }}
              dayMaxEvents={5}
              moreLinkClick="popover"
              datesSet={(arg) => {
                setViewDate(arg.view.currentStart);
                setViewTitle(arg.view.title);
                setRangeStartIso(arg.start.toISOString());
                setRangeEndIso(arg.end.toISOString());
              }}
              /* custom day-header content to render two-line day name + number */
              dayHeaderContent={(arg) => {
                const isToday = arg.isToday;
                return (
                  <div className="flex flex-col items-center gap-0.5 py-2">
                    <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-faint)]">
                      {arg.date.toLocaleDateString([], { weekday: "short" })}
                    </span>
                    <span
                      className={[
                        "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold",
                        isToday
                          ? "bg-[var(--color-primary)] text-white"
                          : "text-[var(--color-text)]",
                      ].join(" ")}
                    >
                      {arg.date.getDate()}
                    </span>
                  </div>
                );
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Meet link success banner ───────────────────── */}
      {createdMeetLink ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-down">
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-xl border border-[var(--color-border)] min-w-[320px] max-w-[480px]">
            {/* Google Meet icon */}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00897B]">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text)]">Meeting created!</p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">{createdMeetLink}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href={createdMeetLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors"
              >
                Join
              </a>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(createdMeetLink);
                }}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
                title="Copy link"
              >
                Copy
              </button>
              <button
                onClick={() => setCreatedMeetLink(null)}
                className="rounded-full p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Schedule meeting modal ─────────────────────── */}
      {scheduleOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div className="card w-full max-w-xl overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Schedule meeting</h3>
              <button type="button" onClick={() => setScheduleOpen(false)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <input
                type="text"
                placeholder="Meeting title *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field"
                autoFocus
              />
              <div>
                <RecipientField
                  placeholder="Recipients (recruiters, guests, contacts) *"
                  value={recruiterEmail}
                  onChange={setRecruiterEmail}
                  suggestions={recipientSuggestions}
                />
                {loadingRecruiters && recipientSuggestions.length === 0 && (
                  <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Loading suggestions…</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Start</label>
                  <input
                    type="datetime-local"
                    value={startDateTime}
                    onChange={(e) => {
                      const next = e.target.value;
                      setStartDateTime(next);
                      if (endDateTime && new Date(endDateTime) <= new Date(next)) {
                        setEndDateTime(applyDurationFromStart(next, 30));
                      }
                    }}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">End</label>
                  <input
                    type="datetime-local"
                    value={endDateTime}
                    onChange={(e) => setEndDateTime(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {([30, 60, 90] as const).map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => startDateTime && setEndDateTime(applyDurationFromStart(startDateTime, mins))}
                    disabled={!startDateTime}
                    className="rounded-full border border-[var(--color-border)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-40"
                  >
                    {mins === 60 ? "1 hr" : `${mins} min`}
                  </button>
                ))}
                <span className="self-center text-[10px] text-[var(--color-text-faint)]">{USER_TZ}</span>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Repeat</span>
                <select
                  value={recurrencePreset}
                  onChange={(e) => setRecurrencePreset(e.target.value as RecurrencePreset)}
                  className="input-field"
                >
                  {RECURRENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <CalendarFreeBusyPanel
                startIso={scheduleStartIso}
                endIso={scheduleEndIso}
                emails={scheduleGuestEmails}
              />
              <input
                type="text"
                placeholder="Location or video call link (optional)"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="input-field"
              />
              <textarea
                rows={3}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-field resize-none"
              />

              {/* Google Meet toggle */}
              <button
                type="button"
                onClick={() => setAddMeet((v) => !v)}
                className={[
                  "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                  addMeet
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]",
                ].join(" ")}
              >
                {/* Meet icon */}
                <span className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                  addMeet ? "bg-[#00897B]" : "bg-[var(--color-surface-offset)]",
                ].join(" ")}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
                  </svg>
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--color-text)]">Google Meet video conference</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {addMeet ? "A Meet link will be generated and shared with attendees" : "No video link — in-person or phone only"}
                  </p>
                </div>
                {/* Toggle pill */}
                <span className={[
                  "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                  addMeet ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]",
                ].join(" ")}>
                  <span className={[
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5",
                    addMeet ? "translate-x-4" : "translate-x-0.5",
                  ].join(" ")} />
                </span>
              </button>

              {scheduleError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {scheduleError}
                </p>
              )}
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <button type="button" onClick={() => setScheduleOpen(false)} className="btn-ghost">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !recruiterEmail || !title || !startDateTime || !endDateTime}
                onClick={() => void scheduleMeeting()}
                className="btn-primary"
              >
                {busy ? "Scheduling…" : addMeet ? "Create with Meet" : "Create event"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Event detail modal ─────────────────────────── */}
      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div className="card w-full max-w-lg overflow-hidden animate-scale-in">
            {/* Colored header strip */}
            <div className="flex items-center justify-between bg-[var(--color-primary)] px-5 py-3">
              <h3 className="text-base font-semibold text-white truncate pr-4">
                {selectedEvent.summary || "(untitled)"}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-full p-1 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <div className="divide-y divide-[var(--color-border)] p-0">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 px-5 py-4 text-sm">
                <dt className="text-[var(--color-text-faint)] font-medium whitespace-nowrap">When</dt>
                <dd className="text-[var(--color-text)]">
                  {formatCalendarDateTime(selectedEvent.start?.dateTime || selectedEvent.start?.date || "")}
                  {" — "}
                  {formatCalendarDateTime(selectedEvent.end?.dateTime || selectedEvent.end?.date || "")}
                  {formatRecurrenceLabel(selectedEvent.recurrence) ? (
                    <span className="mt-1 block text-[12px] text-[var(--color-text-muted)]">
                      ↻ {formatRecurrenceLabel(selectedEvent.recurrence)}
                    </span>
                  ) : selectedEvent.recurringEventId ? (
                    <span className="mt-1 block text-[12px] text-[var(--color-text-muted)]">
                      ↻ Part of a repeating series
                    </span>
                  ) : null}
                </dd>

                {canRsvp(selectedEvent) ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Going?</dt>
                    <dd>
                      <CalendarRsvpButtons
                        eventId={selectedEvent.id}
                        currentStatus={findSelfAttendee(selectedEvent)?.responseStatus}
                        onUpdated={(status) => onRsvpUpdated(selectedEvent, status)}
                        variant="detail"
                      />
                    </dd>
                  </>
                ) : null}

                {selectedEvent.location ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Where</dt>
                    <dd className="text-[var(--color-text)]">
                      {selectedEvent.location.startsWith("http") ? (
                        <a
                          href={selectedEvent.location}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-primary)] hover:underline break-all"
                        >
                          {selectedEvent.location}
                        </a>
                      ) : (
                        selectedEvent.location
                      )}
                    </dd>
                  </>
                ) : null}

                {selectedEvent.attendees?.length ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium pt-0.5">
                      Guests
                      <span className="ml-1 font-normal text-[var(--color-text-faint)]">
                        ({selectedEvent.attendees.length})
                      </span>
                    </dt>
                    <dd>
                      <ul className="space-y-1.5">
                        {selectedEvent.attendees.map((a, i) => {
                          const name = a.displayName || a.email || "Unknown";
                          const initials = name
                            .split(/[\s@.]+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((s) => s[0]?.toUpperCase() ?? "")
                            .join("");
                          const rs = a.responseStatus;
                          const isOrg = a.organizer;

                          // RSVP badge — icon + label exactly like Google Calendar
                          let rsvpIcon: string;
                          let rsvpColor: string;
                          let rsvpLabel: string;
                          if (isOrg) {
                            rsvpIcon = "★"; rsvpColor = "text-[var(--color-primary)]"; rsvpLabel = "Organizer";
                          } else if (rs === "accepted") {
                            rsvpIcon = "✓"; rsvpColor = "text-[var(--color-success)]"; rsvpLabel = "Accepted";
                          } else if (rs === "declined") {
                            rsvpIcon = "✗"; rsvpColor = "text-[var(--color-danger)]"; rsvpLabel = "Declined";
                          } else if (rs === "tentative") {
                            rsvpIcon = "?"; rsvpColor = "text-[var(--color-warning)]"; rsvpLabel = "Maybe";
                          } else {
                            rsvpIcon = "·"; rsvpColor = "text-[var(--color-text-faint)]"; rsvpLabel = "Awaiting";
                          }

                          return (
                            <li key={i} className="flex items-center gap-2.5">
                              {/* Avatar */}
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-tint)] text-[10px] font-bold text-[var(--color-primary)]">
                                {initials || "?"}
                              </span>
                              {/* Name / email */}
                              <span className="flex-1 min-w-0">
                                {a.displayName ? (
                                  <>
                                    <p className="text-sm font-medium text-[var(--color-text)] truncate leading-tight">{a.displayName}</p>
                                    <p className="text-[11px] text-[var(--color-text-faint)] truncate leading-tight">{a.email}</p>
                                  </>
                                ) : (
                                  <p className="text-sm text-[var(--color-text)] truncate">{a.email}</p>
                                )}
                              </span>
                              {/* RSVP status */}
                              <span className={`flex items-center gap-0.5 text-[11px] font-medium shrink-0 ${rsvpColor}`} title={rsvpLabel}>
                                <span>{rsvpIcon}</span>
                                <span className="hidden sm:inline">{rsvpLabel}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </dd>
                  </>
                ) : null}

                {selectedEvent.description ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Notes</dt>
                    <dd className="whitespace-pre-wrap text-[var(--color-text)]">
                      {selectedEvent.description}
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setSelectedEvent(null)} className="btn-ghost">
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(selectedEvent)}
                  className="btn-secondary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => openDeleteConfirm(selectedEvent)}
                  disabled={deleteBusy}
                  className="btn-ghost text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] disabled:opacity-50"
                  title="Delete this meeting"
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedEvent.hangoutLink ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(selectedEvent.hangoutLink!)}
                      className="btn-secondary text-xs"
                    >
                      Copy Meet link
                    </button>
                    <a
                      href={selectedEvent.hangoutLink}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary"
                    >
                      Join meeting
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Edit event modal ───────────────────────────────── */}
      {editEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div className="card w-full max-w-xl overflow-hidden animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Edit event</h3>
              <button type="button" onClick={() => setEditEvent(null)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-5">
              {/* Title */}
              <input
                type="text"
                placeholder="Meeting title *"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="input-field"
                autoFocus
              />

              {/* Times */}
              {editAllDay ? (
                <p className="rounded-lg bg-[var(--color-surface-offset)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  All-day events can be edited in Google Calendar. Timed reschedule is not supported here.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="datetime-local"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    className="input-field"
                  />
                  <input
                    type="datetime-local"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="input-field"
                  />
                </div>
              )}

              {!editAllDay && !editIsSeriesInstance ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Repeat</span>
                  <select
                    value={editRecurrencePreset}
                    onChange={(e) => setEditRecurrencePreset(e.target.value as RecurrencePreset)}
                    className="input-field"
                  >
                    {RECURRENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : editIsSeriesInstance ? (
                <p className="rounded-lg bg-[var(--color-surface-offset)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  Recurrence applies to the whole series — edit the series in Google Calendar to change the repeat rule.
                </p>
              ) : null}

              {!editAllDay ? (
                <CalendarFreeBusyPanel
                  startIso={editStartIso}
                  endIso={editEndIso}
                  emails={editGuestEmails}
                />
              ) : null}

              <input
                type="text"
                placeholder="Location (optional)"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                className="input-field"
              />

              {!editAllDay && !editEvent.hangoutLink ? (
                <button
                  type="button"
                  onClick={() => setEditAddMeet((v) => !v)}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    editAddMeet
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-offset)]",
                  ].join(" ")}
                >
                  <span className="text-sm font-medium text-[var(--color-text)]">Add Google Meet</span>
                  <span className={[
                    "ml-auto relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
                    editAddMeet ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]",
                  ].join(" ")}>
                    <span className={[
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5",
                      editAddMeet ? "translate-x-4" : "translate-x-0.5",
                    ].join(" ")} />
                  </span>
                </button>
              ) : null}

              {/* Attendees */}
              <div>
                <RecipientField
                  placeholder="Guests (recruiters, contacts)"
                  value={editAttendees}
                  onChange={setEditAttendees}
                  suggestions={recipientSuggestions}
                />
              </div>

              {/* Notes */}
              <textarea
                rows={3}
                placeholder="Notes (optional)"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="input-field resize-none"
              />

              {/* Notify guests — Google Calendar style */}
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <p className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                  Notify guests about changes?
                </p>
                {(
                  [
                    { value: "all" as SendUpdates,          label: "Yes, send update email to all guests" },
                    { value: "externalOnly" as SendUpdates, label: "Only external guests" },
                    { value: "none" as SendUpdates,         label: "No, don't send emails" },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    className={[
                      "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors last:pb-3",
                      editNotify === value
                        ? "bg-[var(--color-primary-light)]"
                        : "hover:bg-[var(--color-surface-offset)]",
                    ].join(" ")}
                  >
                    <span className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      editNotify === value
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                        : "border-[var(--color-border-strong)]",
                    ].join(" ")}>
                      {editNotify === value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <input
                      type="radio"
                      name="notify"
                      value={value}
                      checked={editNotify === value}
                      onChange={() => setEditNotify(value)}
                      className="sr-only"
                    />
                    <span className="text-sm text-[var(--color-text)]">{label}</span>
                  </label>
                ))}
              </div>

              {editError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {editError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <button
                type="button"
                onClick={() => editEvent && openDeleteConfirm(editEvent)}
                disabled={deleteBusy}
                className="btn-ghost text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] disabled:opacity-50"
                title="Delete this meeting"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
              <div className="flex gap-2">
              <button type="button" onClick={() => setEditEvent(null)} className="btn-ghost">
                Cancel
              </button>
              <button
                type="button"
                disabled={editBusy || !editTitle || (!editAllDay && (!editStart || !editEnd))}
                onClick={() => void saveEdit()}
                className="btn-primary"
              >
                {editBusy ? "Saving…" : editNotify === "none" ? "Save quietly" : "Save & notify"}
              </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Delete confirmation modal (with optional note) ──── */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-md overflow-hidden animate-scale-in">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                Delete meeting?
              </h3>
              <p className="mt-1 text-[13px] text-[var(--color-text-muted)] line-clamp-2">
                {deleteTarget.summary || "(untitled meeting)"}
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              {(deleteTarget.attendees?.length ?? 0) > 0 ? (
                <>
                  <p className="text-[13px] text-[var(--color-text)]">
                    All {deleteTarget.attendees?.length} guests will receive a cancellation email.
                  </p>
                  <div>
                    <label htmlFor="delete-note" className="mb-1 block text-[12px] font-medium text-[var(--color-text-muted)]">
                      Add a note to guests <span className="text-[var(--color-text-faint)]">(optional)</span>
                    </label>
                    <textarea
                      id="delete-note"
                      rows={3}
                      value={deleteNote}
                      onChange={(e) => setDeleteNote(e.target.value)}
                      placeholder="Explain why you're cancelling…"
                      className="input-field w-full resize-none text-[13px]"
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                      Sent as a separate email after the cancellation notice.
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-[var(--color-text)]">
                  This meeting will be permanently deleted.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteNote(""); }}
                disabled={deleteBusy}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleteBusy}
                className="rounded-[var(--radius-md)] bg-[var(--color-danger)] px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
