"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceTopbarActionsNode } from "@/lib/workspace-topbar-context";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Check, Copy, Paperclip, Repeat, Video } from "lucide-react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { useModuleVisibility } from "@/lib/module-visibility";
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
import CalendarRecurrenceEditor from "@/components/CalendarRecurrenceEditor";
import CalendarEventOptions from "@/components/CalendarEventOptions";
import CalendarScopeDialog, { ScopeChoice } from "@/components/CalendarScopeDialog";
import {
  defaultOptions,
  optionsFromEvent,
  optionsToExtras,
  reminderLabel,
  type EventOptions,
} from "@/lib/calendar-extras";
import { addDaysToDate, utcMsToWall, wallToUtcMs } from "@/lib/calendar-time";
import type { SeriesScope } from "@/lib/google-calendar";
import {
  DEFAULT_CUSTOM_SPEC,
  RECURRENCE_OPTIONS,
  WEEKDAYS,
  buildRecurrence,
  formatRecurrenceLabel,
  parseRecurrence,
  validateSpec,
  type RecurrencePreset,
  type RecurrenceSpec,
} from "@/lib/calendar-recurrence";
import { CalendarFreeBusyPanel } from "@/components/CalendarFreeBusyPanel";
import { CalendarRsvpButtons, type RsvpStatus } from "@/components/CalendarRsvpButtons";
import {
  defaultCalendarRangeIso,
  getCalendarPrefetchCache,
  patchCalendarPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

/* ─── Types ─────────────────────────────────────────────────── */
type Attendee = {
  email?: string;
  displayName?: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction" | string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
  comment?: string;
};

type EventRow = {
  id: string;
  summary?: string;
  htmlLink?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Attendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  recurrence?: string[];
  recurringEventId?: string;
  /** The Google Meet join link, when the event has one. */
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
  visibility?: string;
  transparency?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  attachments?: { fileUrl?: string; title?: string; mimeType?: string; fileId?: string }[];
};

/** Guests other than the organizer and the signed-in user — the people a change or cancellation is sent to. */
function realGuests(ev: EventRow): Attendee[] {
  return (ev.attendees ?? []).filter((a) => a.email && !a.organizer && !a.self && !a.resource);
}

/** The UTC instant of a wall time in a zone, as an ISO string — null while the text isn't a full date-time. */
function wallToIso(wall: string, tz: string): string | null {
  const ms = wallToUtcMs(wall, tz);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Minutes between two "YYYY-MM-DDTHH:mm" wall times (wall clock, so a DST change doesn't count). */
function wallMinutesBetween(from: string, to: string): number {
  const ms = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10), +w.slice(11, 13), +w.slice(14, 16));
  return Math.round((ms(to) - ms(from)) / 60_000);
}

/** What the event's "show as" / visibility add to its details. */
const VISIBILITY_TEXT: Record<string, string> = { public: "Public", private: "Private", confidential: "Confidential" };

/** The Meet join link of an event, from `hangoutLink` or its video entry point. */
function meetUrlOf(ev: EventRow): string | undefined {
  return ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || undefined;
}

type SendUpdates = "all" | "externalOnly" | "none";

type ViewType = "timeGridWeek" | "timeGridDay" | "dayGridMonth";

/* ─── Helpers ───────────────────────────────────────────────── */
function parseMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function eventStartMs(e: EventRow): number | null {
  return parseMs(e.start?.dateTime || e.start?.date);
}

/** Weekday code of a "YYYY-MM-DDTHH:mm" input value. */
function weekdayOf(value: string) {
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : WEEKDAYS[(d.getDay() + 6) % 7];
}

function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Some browsers report India as the legacy "Asia/Calcutta"; use the current name.
const USER_TZ =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/^Asia\/Calcutta$/, "Asia/Kolkata")
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

function formatEventWhen(ev: EventRow): string {
  const startRaw = ev.start?.dateTime || ev.start?.date;
  const endRaw = ev.end?.dateTime || ev.end?.date;
  if (!startRaw) return "";
  if (isAllDayEvent(ev)) {
    const start = formatCalendarDateTime(startRaw);
    const end = endRaw && endRaw !== startRaw ? formatCalendarDateTime(endRaw) : null;
    return end ? `${start} – ${end}` : start;
  }
  const start = formatCalendarDateTime(startRaw);
  const end = endRaw ? formatCalendarDateTime(endRaw) : "";
  return end ? `${start} – ${end}` : start;
}

/* ─── Main Page ─────────────────────────────────────────────── */
export default function CalendarPage() {
  const topbarActionsNode = useWorkspaceTopbarActionsNode();
  const calendarRef = useRef<FullCalendar>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<EventRow[]>([]);
  // Google contacts — power the same autocomplete used by the Compose mail modal.
  const [googleContacts, setGoogleContacts] = useState<RecipientSuggestion[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarSearchInput, setCalendarSearchInput] = useState("");
  const [calendarSearchQuery, setCalendarSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EventRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // View state
  const [currentView, setCurrentView] = useState<ViewType>("timeGridWeek");
  /**
   * False during SSR and the first client render. USER_TZ is read from
   * Intl at module scope, and Node resolves IST to the legacy alias
   * "Asia/Calcutta" while browsers return the canonical "Asia/Kolkata" — so
   * rendering it straight away makes the server and client disagree on a text
   * node and React throws a hydration error. The server's value is wrong for
   * the viewer anyway, so render it only once we are in the browser.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * This page leans on the Mail module for conveniences: attendee autocomplete
   * and the "notify guests" note. They degrade to manual entry rather than
   * disappearing, but their requests must not fire when the module is off —
   * middleware 403s them.
   */
  const { isVisible } = useModuleVisibility();
  const mailEnabled = isVisible("inbox");
  const [viewTitle, setViewTitle] = useState("");
  const [rangeStartIso, setRangeStartIso] = useState<string | null>(null);
  const [rangeEndIso, setRangeEndIso] = useState<string | null>(null);

  // Modals
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);

  // Create form fields
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  // Create a Google Meet room with the event. On by default: these are mostly recruiter calls.
  const [addMeet, setAddMeet] = useState(true);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetCopied, setMeetCopied] = useState(false);
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("none");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(""); // last day, inclusive
  const [notify, setNotify] = useState<SendUpdates>("all");
  const [scheduleOpts, setScheduleOpts] = useState<EventOptions>(() => defaultOptions(USER_TZ));
  const [customSpec, setCustomSpec] = useState<RecurrenceSpec>(DEFAULT_CUSTOM_SPEC);

  // Signed-in user emails — for in-app RSVP matching
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [mailboxEmail, setMailboxEmail] = useState<string | null>(null);

  // Edit form fields
  const [editError, setEditError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
  const [editAttendees, setEditAttendees] = useState(""); // comma-sep emails
  const [editNotify, setEditNotify] = useState<SendUpdates>("all");
  const [editRecurrencePreset, setEditRecurrencePreset] = useState<RecurrencePreset>("none");
  const [editCustomSpec, setEditCustomSpec] = useState<RecurrenceSpec>(DEFAULT_CUSTOM_SPEC);
  const [editOpts, setEditOpts] = useState<EventOptions>(() => defaultOptions(USER_TZ));
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState(""); // last day, inclusive
  // The times as the event had them — a repeating series moves by how far they were changed.
  const [editOrig, setEditOrig] = useState<{ start: string; end: string; tz: string } | null>(null);
  const [askScope, setAskScope] = useState(false);
  const [editIsSeriesInstance, setEditIsSeriesInstance] = useState(false);

  /* ── Data loading ────────────────────────────────────── */

  const loadEvents = useCallback(async (timeMin?: string, timeMax?: string) => {
    const defaults = defaultCalendarRangeIso();
    const usingDefaultRange = !timeMin && !timeMax;
    if (usingDefaultRange) {
      const cached = getCalendarPrefetchCache();
      if (cached?.events.length) {
        setEvents(cached.events as EventRow[]);
        setLoadingEvents(false);
      } else {
        setLoadingEvents(true);
      }
    } else {
      setLoadingEvents(true);
    }
    setError(null);
    try {
      const start = timeMin || defaults.timeMin;
      const end = timeMax || defaults.timeMax;
      const res = await fetch(
        `/api/calendar/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&maxResults=500`
      );
      const body = (await res.json()) as { events?: EventRow[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load events");
      const list = body.events || [];
      setEvents(list);
      if (usingDefaultRange) {
        patchCalendarPrefetchCache({ events: list });
      }
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setCalendarSearchQuery(calendarSearchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [calendarSearchInput]);

  useEffect(() => {
    if (!calendarSearchQuery) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    fetch(
      `/api/calendar/events?q=${encodeURIComponent(calendarSearchQuery)}&maxResults=100`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        const body = (await res.json()) as { events?: EventRow[]; error?: string };
        if (!res.ok) throw new Error(body.error || "Search failed");
        if (cancelled) return;
        setSearchResults(body.events ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(e instanceof Error ? e.message : "Search failed");
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarSearchQuery]);


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
    const cached = getCalendarPrefetchCache();
    if (cached?.googleContacts.length) {
      setGoogleContacts(cached.googleContacts as RecipientSuggestion[]);
    }
    if (!mailEnabled) return;
    let cancelled = false;
    fetch("/api/gmail/contacts")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const contacts = (j as { contacts?: RecipientSuggestion[] } | null)?.contacts;
        if (Array.isArray(contacts)) {
          setGoogleContacts(contacts);
          patchCalendarPrefetchCache({ googleContacts: contacts });
        }
      })
      .catch(() => {/* non-fatal — recruiters still work */});
    return () => { cancelled = true; };
  }, [mailEnabled]);

  // Turn Google contacts into the suggestion list shape that RecipientField
  // expects. Email is the dedup key.
  const recipientSuggestions = useMemo((): RecipientSuggestion[] => {
    const map = new Map<string, string>();
    for (const c of googleContacts) {
      const em = c.email.trim().toLowerCase();
      if (em) map.set(em, c.displayName?.trim() || em);
    }
    return Array.from(map.entries()).map(([email, label]) => ({
      email,
      displayName: label !== email ? label : undefined,
    }));
  }, [googleContacts]);
  useEffect(() => {
    void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
  }, [loadEvents, rangeStartIso, rangeEndIso]);

  /* ── Calendar API helpers ────────────────────────────── */
  const getApi = () => calendarRef.current?.getApi();

  // A week is seven columns, too narrow to read on a phone: open on a single day there.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) goView("timeGridDay");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goView(v: ViewType) {
    setCurrentView(v);
    getApi()?.changeView(v);
  }

  function goPrev() { getApi()?.prev(); }
  function goNext() { getApi()?.next(); }
  function goToday() { getApi()?.today(); }


  function openScheduleModal(prefill?: {
    start?: string;
    end?: string;
    title?: string;
    recruiterEmail?: string;
    notes?: string;
    location?: string;
    options?: EventOptions;
    addMeet?: boolean;
    /** All-day: first day and LAST day (inclusive), "YYYY-MM-DD". */
    allDay?: { startDate: string; endDate: string };
  }) {
    const defaults = defaultMeetingTimes();
    setStartDateTime(prefill?.start ?? defaults.start);
    setEndDateTime(prefill?.end ?? defaults.end);
    setAllDay(!!prefill?.allDay);
    setStartDate(prefill?.allDay?.startDate ?? defaults.start.slice(0, 10));
    setEndDate(prefill?.allDay?.endDate ?? defaults.start.slice(0, 10));
    setRecurrencePreset("none");
    setCustomSpec(DEFAULT_CUSTOM_SPEC);
    setNotify("all");
    setScheduleOpts(prefill?.options ?? defaultOptions(USER_TZ));
    setScheduleError(null);
    setAddMeet(prefill?.addMeet ?? true);
    if (prefill?.notes !== undefined) setNotes(prefill.notes);
    if (prefill?.location !== undefined) setLocation(prefill.location);
    if (prefill?.title !== undefined) setTitle(prefill.title);
    if (prefill?.recruiterEmail !== undefined) setRecruiterEmail(prefill.recruiterEmail);
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

  // A repeating occurrence doesn't carry its rule — the series' own record does, fetched once per series.
  const [seriesRules, setSeriesRules] = useState<Record<string, string[] | null>>({});
  useEffect(() => {
    const id = selectedEvent && !selectedEvent.recurrence?.length ? selectedEvent.recurringEventId : undefined;
    if (!id || id in seriesRules) return;
    let cancelled = false;
    const remember = (rule: string[] | null) => {
      if (!cancelled) setSeriesRules((m) => ({ ...m, [id]: rule }));
    };
    fetch(`/api/calendar/events/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((b: { event?: { recurrence?: string[] } }) => remember(b.event?.recurrence?.length ? b.event.recurrence : null))
      .catch(() => remember(null));
    return () => {
      cancelled = true;
    };
  }, [selectedEvent, seriesRules]);

  /** "Weekly on Monday" — how Google Calendar words the repeat. */
  function repeatLabelOf(ev: EventRow): string | null {
    const rule = ev.recurrence?.length ? ev.recurrence : ev.recurringEventId ? seriesRules[ev.recurringEventId] : null;
    if (!rule) return null;
    const tz = ev.start?.timeZone || USER_TZ;
    const day = ev.start?.date || (ev.start?.dateTime ? utcMsToWall(Date.parse(ev.start.dateTime), tz).slice(0, 10) : undefined);
    return formatRecurrenceLabel(rule, tz, day);
  }

  /** Open the schedule form filled from an existing event (same time, guests, settings). */
  function duplicateEvent(ev: EventRow) {
    const options = optionsFromEvent(ev, USER_TZ);
    const wall = (iso?: string) => (iso ? utcMsToWall(Date.parse(iso), options.timeZone) : undefined);
    setSelectedEvent(null);
    openScheduleModal({
      title: ev.summary ?? "",
      recruiterEmail: realGuests(ev).map((a) => a.email).join(", "),
      notes: ev.description ?? "",
      location: ev.location ?? "",
      options,
      addMeet: !!meetUrlOf(ev),
      ...(isAllDayEvent(ev) && ev.start?.date
        ? { allDay: { startDate: ev.start.date, endDate: ev.end?.date ? addDaysToDate(ev.end.date, -1) : ev.start.date } }
        : { start: wall(ev.start?.dateTime), end: wall(ev.end?.dateTime) }),
    });
  }

  /** Add a Google Meet room to an event that doesn't have one (guests are told about the new link). */
  async function addMeetToEvent(ev: EventRow) {
    setMeetBusy(true);
    setError(null);
    try {
      const hasGuests = (ev.attendees ?? []).some((a) => !a.self && !a.organizer);
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(ev.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addMeetLink: true, sendUpdates: hasGuests ? "all" : "none" }),
      });
      const body = (await res.json()) as { error?: string; event?: EventRow; meetError?: string | null };
      if (!res.ok) throw new Error(body.error || "Couldn't add a Meet link");
      if (body.event) {
        const updated = body.event;
        setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, ...updated } : e)));
        setSelectedEvent((cur) => (cur?.id === ev.id ? { ...cur, ...updated } : cur));
      }
      if (body.meetError) setError(body.meetError);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setMeetBusy(false);
    }
  }

  async function copyMeetLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMeetCopied(true);
      window.setTimeout(() => setMeetCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still shown and clickable */
    }
  }

  function onDateSelect(arg: DateSelectArg) {
    // Dragging across day cells (month view / all-day strip) makes an all-day event, like Google Calendar.
    if (arg.allDay) {
      const day = (d: Date) => toInputValue(d).slice(0, 10);
      const last = addDaysToDate(day(arg.end), -1);
      const first = day(arg.start);
      openScheduleModal({ allDay: { startDate: first, endDate: last < first ? first : last } });
      return;
    }
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

  function clearCalendarSearch() {
    setCalendarSearchInput("");
    setCalendarSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
  }

  function openSearchResult(ev: EventRow) {
    const startMs = eventStartMs(ev);
    if (startMs) {
      const d = new Date(startMs);
      getApi()?.gotoDate(d);
    }
    setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
    clearCalendarSearch();
    setSelectedEvent(ev);
  }

  /* ── FullCalendar events ─────────────────────────────── */
  const calendarEvents = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        title: `${e.recurrence?.length || e.recurringEventId ? "↻ " : ""}${e.summary || "(untitled)"}`,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        url: "",
        allDay: !e.start?.dateTime,
        editable: !isAllDayEvent(e),
      })),
    [events]
  );

  /* ── Schedule meeting (create) ───────────────────────── */
  async function scheduleMeeting() {
    const allEmails = extractAllEmailsFromText(recruiterEmail);
    const primary = allEmails[0];
    const extras = allEmails.slice(1);
    const tz = scheduleOpts.timeZone;
    const startIso = allDay ? null : wallToIso(startDateTime, tz);
    const endIso = allDay ? null : wallToIso(endDateTime, tz);
    if (!title || (allDay ? !startDate || !endDate : !startIso || !endIso)) {
      setScheduleError("Fill in the title and the start/end times.");
      return;
    }
    if (allDay ? endDate < startDate : new Date(endIso!) <= new Date(startIso!)) {
      setScheduleError(allDay ? "The last day can't be before the first day." : "End time must be after start time.");
      return;
    }
    if (recurrencePreset === "custom") {
      const problem = validateSpec(customSpec, allDay ? startDate : startDateTime.slice(0, 10));
      if (problem) {
        setScheduleError(problem);
        return;
      }
    }
    // Close the form right away and finish in the background; if Google refuses, it comes back as it was.
    setScheduleError(null);
    setError(null);
    setScheduleOpen(false);
    showToast({ tone: "busy", text: "Creating event…" });
    try {
      const res = await fetch("/api/calendar/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiterEmail: primary ?? "",
          title,
          notes,
          location: location.trim() || undefined,
          timeZone: tz,
          ...(allDay
            ? { allDay: true, startDate, endDate: addDaysToDate(endDate, 1) } // Google's all-day end is the day AFTER
            : { startDateTime: startIso, endDateTime: endIso }),
          recurrence: buildRecurrence(recurrencePreset, customSpec, { allDay, timeZone: tz }),
          sendUpdates: notify,
          extras: optionsToExtras(scheduleOpts),
          extraAttendeeEmails: extras.length ? extras : undefined,
          addMeetLink: addMeet,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        event?: { htmlLink?: string };
        /** Set when a Meet was asked for but Google couldn't add one — the event itself was still created. */
        meetError?: string | null;
      };
      if (!res.ok) throw new Error(body.error || "Failed to schedule meeting");
      if (body.meetError) setError(body.meetError);

      setRecruiterEmail("");
      setTitle("");
      setNotes("");
      setLocation("");
      showToast({ tone: "ok", text: "Event created" });
      // Show it on the grid now; the refresh below brings the full details.
      const created = body.event as EventRow | undefined;
      if (created?.id) setEvents((prev) => (prev.some((e) => e.id === created.id) ? prev : [...prev, created]));
      void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      const message = clientFetchFailedMessage(e);
      setScheduleError(message);
      setScheduleOpen(true);
      showToast({ tone: "error", text: `Couldn't create “${title}”: ${message}` });
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
    const tz = ev.start?.timeZone || USER_TZ;
    const wall = (iso?: string) => (iso ? utcMsToWall(Date.parse(iso), tz) : "");
    const startWall = allDay ? "" : wall(ev.start?.dateTime);
    const endWall = allDay ? "" : wall(ev.end?.dateTime);
    setEditStart(startWall);
    setEditEnd(endWall);
    setEditStartDate(allDay ? ev.start?.date || "" : "");
    setEditEndDate(allDay && ev.end?.date ? addDaysToDate(ev.end.date, -1) : ev.start?.date || "");
    setEditOrig({ start: startWall, end: endWall, tz });
    setEditOpts(optionsFromEvent(ev, USER_TZ));
    setAskScope(false);
    setEditAttendees((ev.attendees ?? []).map((a) => a.email).filter(Boolean).join(", "));
    const parsedRule = parseRecurrence(ev.recurrence, ev.start?.timeZone || USER_TZ);
    setEditRecurrencePreset(parsedRule.preset);
    setEditCustomSpec(parsedRule.spec ?? DEFAULT_CUSTOM_SPEC);
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
  const [deleteScope, setDeleteScope] = useState<SeriesScope>("this");
  const [deleteNotify, setDeleteNotify] = useState<SendUpdates>("all");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // After a delete: what's needed to bring it back, shown as an "Undo" toast for a few seconds.
  const [undoInfo, setUndoInfo] = useState<{ eventId: string; undo: unknown; title: string; sendUpdates: SendUpdates } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const undoTimer = useRef<number | null>(null);
  // Saves run in the background: the form closes at once and this shows how it's going.
  const [toast, setToast] = useState<{ tone: "busy" | "ok" | "error"; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  function showToast(next: { tone: "busy" | "ok" | "error"; text: string } | null) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(next);
    if (next && next.tone !== "busy") {
      toastTimer.current = window.setTimeout(() => setToast(null), next.tone === "error" ? 8000 : 3000);
    }
  }

  function openDeleteConfirm(ev: EventRow) {
    setDeleteTarget(ev);
    setDeleteNote("");
    setDeleteScope("this");
    setDeleteNotify("all");
    setDeleteError(null);
  }

  function closeDeleteConfirm() {
    setDeleteTarget(null);
    setDeleteNote("");
    setDeleteError(null);
  }

  /** The organizer's own event, or one with no organizer info (e.g. created here). Guests can't cancel it for others. */
  function isOrganizerOf(ev: EventRow): boolean {
    return !ev.organizer || ev.organizer.self === true;
  }

  function isRepeating(ev: EventRow): boolean {
    return !!ev.recurringEventId || !!ev.recurrence?.length;
  }

  /** Send a follow-up email to a meeting's attendees explaining a change
   *  or cancellation. No-op if there are no attendees or the note is empty. */
  async function sendAttendeeNote(
    ev: EventRow,
    note: string,
    kind: "cancelled" | "updated"
  ): Promise<void> {
    // Google Calendar already e-mails attendees about the change itself; this
    // extra organizer note goes out through our own mailbox, so it is skipped
    // with Mail off rather than failing silently on a 403.
    if (!mailEnabled) return;
    const recipients = realGuests(ev)
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
    const guests = realGuests(ev);
    const organizer = isOrganizerOf(ev);
    // Only the organizer's cancellation goes to guests; removing a copy from your own calendar tells no one.
    const sendUpdates: SendUpdates = organizer && guests.length > 0 ? deleteNotify : "none";
    const scope = isRepeating(ev) ? deleteScope : "this";
    // Take it off the grid and close the dialog at once; it's put back if Google refuses.
    const before = events;
    const seriesId = ev.recurringEventId ?? ev.id;
    const evStart = eventStartMs(ev) ?? 0;
    setEvents((prev) =>
      prev.filter((e) => {
        if (scope === "this") return e.id !== ev.id;
        if ((e.recurringEventId ?? e.id) !== seriesId) return true;
        return scope === "following" ? (eventStartMs(e) ?? 0) < evStart : false;
      })
    );
    setSelectedEvent(null);
    setEditEvent(null);
    closeDeleteConfirm();
    showToast({ tone: "busy", text: "Deleting…" });
    try {
      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(ev.id)}?sendUpdates=${sendUpdates}&scope=${scope}`,
        { method: "DELETE" }
      );
      const body = (await res.json()) as { error?: string; undo?: unknown };
      if (!res.ok) throw new Error(body.error || "Failed to delete event");
      // Optional follow-up email with the user's note — only when guests were told.
      if (deleteNote.trim() && organizer && guests.length > 0 && sendUpdates !== "none") {
        void sendAttendeeNote(ev, deleteNote, "cancelled");
      }
      showToast(null);
      if (body.undo) {
        if (undoTimer.current) window.clearTimeout(undoTimer.current);
        setUndoInfo({ eventId: ev.id, undo: body.undo, title: ev.summary || "Event", sendUpdates });
        undoTimer.current = window.setTimeout(() => setUndoInfo(null), 10_000);
      }
      void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setEvents(before);
      showToast({ tone: "error", text: `Couldn't delete “${ev.summary || "event"}”: ${clientFetchFailedMessage(e)}` });
    }
  }

  /** A guest turns the event down instead of removing it: the organizer sees "declined". */
  async function declineEvent(ev: EventRow, scope: SeriesScope) {
    // "All events" is the series itself; Google has no "this and following" for a reply.
    const targetId = scope === "all" && ev.recurringEventId ? ev.recurringEventId : ev.id;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(targetId)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "declined" }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't decline the event");
      setSelectedEvent(null);
      closeDeleteConfirm();
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setDeleteError(clientFetchFailedMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function undoDelete() {
    const info = undoInfo;
    if (!info) return;
    setUndoBusy(true);
    try {
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(info.eventId)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo: info.undo, sendUpdates: info.sendUpdates }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't restore the event");
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoInfo(null);
      await loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
      setUndoInfo(null);
    } finally {
      setUndoBusy(false);
    }
  }

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    []
  );

  /* ── Save edits ──────────────────────────────────────── */
  /** Validates the edit form. The scope question (repeating events) comes after, then `saveEdit`. */
  function requestSaveEdit() {
    if (!editEvent || !editTitle) return;
    if (editAllDay) {
      if (!editStartDate || !editEndDate) return;
      if (editEndDate < editStartDate) {
        setEditError("The last day can't be before the first day.");
        return;
      }
    } else {
      if (!editStart || !editEnd) return;
      const s0 = wallToIso(editStart, editOpts.timeZone);
      const e0 = wallToIso(editEnd, editOpts.timeZone);
      if (!s0 || !e0 || new Date(e0) <= new Date(s0)) {
        setEditError("End time must be after start time.");
        return;
      }
    }
    if (editRecurrencePreset === "custom" && !editIsSeriesInstance) {
      const problem = validateSpec(editCustomSpec, editAllDay ? editStartDate : editStart.slice(0, 10));
      if (problem) {
        setEditError(problem);
        return;
      }
    }
    setEditError(null);
    if (isRepeating(editEvent)) setAskScope(true);
    else void saveEdit("this");
  }

  async function saveEdit(scope: SeriesScope) {
    const ev = editEvent;
    if (!ev) return;
    setAskScope(false);
    setEditError(null);
    // Close the form right away and finish in the background; if Google refuses, it comes back as it was.
    setEditEvent(null);
    showToast({ tone: "busy", text: "Saving changes…" });
    try {
      const tz = editOpts.timeZone;
      // Keep each guest's reply, optional flag and note — sending bare emails would reset them.
      const known = new Map((ev.attendees ?? []).filter((a) => a.email).map((a) => [a.email!.toLowerCase(), a]));
      const attendees = extractAllEmailsFromText(editAttendees).map((email) => {
        const old = known.get(email.toLowerCase());
        return old
          ? { email, responseStatus: old.responseStatus, optional: old.optional, comment: old.comment }
          : { email };
      });
      const start = editAllDay
        ? { date: editStartDate }
        : { dateTime: wallToIso(editStart, tz)!, timeZone: tz };
      const end = editAllDay
        ? { date: addDaysToDate(editEndDate, 1) } // Google's all-day end is the day AFTER
        : { dateTime: wallToIso(editEnd, tz)!, timeZone: tz };

      // For "all events": how far the times moved, as wall-clock minutes, so the series moves with them.
      const orig = editOrig;
      const shifts =
        scope === "all" && orig
          ? editAllDay
            ? {
                startShiftMinutes: wallMinutesBetween(`${ev.start?.date}T00:00`, `${editStartDate}T00:00`),
                endShiftMinutes: wallMinutesBetween(`${ev.end?.date}T00:00`, `${addDaysToDate(editEndDate, 1)}T00:00`),
              }
            : {
                startShiftMinutes: wallMinutesBetween(orig.start, editStart),
                endShiftMinutes: wallMinutesBetween(orig.end, editEnd),
                ...(orig.tz !== tz ? { timeZone: tz, originalTimeZone: orig.tz } : {}),
              }
          : {};

      const res = await fetch(`/api/calendar/events/${encodeURIComponent(ev.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: editTitle,
          description: editNotes || undefined,
          location: editLocation.trim() || undefined,
          start,
          end,
          attendees,
          sendUpdates: editNotify,
          scope,
          extras: optionsToExtras(editOpts),
          ...shifts,
          // A repeating occurrence's own record has no rule; its series' rule isn't edited here.
          // "keep" = an existing rule the editor can't express: leave it untouched.
          ...(editIsSeriesInstance || editRecurrencePreset === "keep"
            ? {}
            : {
                recurrence:
                  editRecurrencePreset === "none"
                    ? []
                    : buildRecurrence(editRecurrencePreset, editCustomSpec, { allDay: editAllDay, timeZone: tz }),
              }),
        }),
      });
      const body = (await res.json()) as { error?: string; event?: EventRow };
      if (!res.ok) throw new Error(body.error || "Failed to update event");
      showToast({ tone: "ok", text: "Event updated" });
      void loadEvents(rangeStartIso || undefined, rangeEndIso || undefined);
    } catch (e) {
      const message = clientFetchFailedMessage(e);
      setEditEvent((cur) => cur ?? ev);
      setEditError(message);
      showToast({ tone: "error", text: `Couldn't save “${editTitle}”: ${message}` });
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

  /**
   * Deep-link from a contact's "Schedule meeting" quick action:
   * ?action=new&attendee=<email>&title=<text> opens the create-meeting card
   * pre-filled with that contact, instead of a blank form.
   */
  const handledNewMeetingDeepLinkRef = useRef(false);
  useEffect(() => {
    if (handledNewMeetingDeepLinkRef.current) return;
    const action = searchParams.get("action");
    if (action !== "new") return;
    handledNewMeetingDeepLinkRef.current = true;
    const attendee = searchParams.get("attendee") ?? undefined;
    const title = searchParams.get("title") ?? undefined;
    openScheduleModal({ recruiterEmail: attendee, title });
    router.replace("/calendar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  const scheduleGuestEmails = useMemo(
    () => extractAllEmailsFromText(recruiterEmail),
    [recruiterEmail]
  );

  const scheduleStartIso = startDateTime && !allDay ? wallToIso(startDateTime, scheduleOpts.timeZone) : null;
  const scheduleEndIso = endDateTime && !allDay ? wallToIso(endDateTime, scheduleOpts.timeZone) : null;

  const editGuestEmails = useMemo(
    () => extractAllEmailsFromText(editAttendees),
    [editAttendees]
  );

  const editStartIso = editStart && !editAllDay ? wallToIso(editStart, editOpts.timeZone) : null;
  const editEndIso = editEnd && !editAllDay ? wallToIso(editEnd, editOpts.timeZone) : null;

  const topbarActions = topbarActionsNode
    ? createPortal(
        <>
          <div className="relative hidden w-[260px] md:block">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              data-testid="calendar-search-input"
              type="search"
              value={calendarSearchInput}
              onChange={(e) => setCalendarSearchInput(e.target.value)}
              placeholder="Search Calendar…"
              className="h-9 w-full rounded-[10px] border border-transparent bg-[var(--color-surface-2)] pl-8 pr-8 text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
              autoComplete="off"
            />
            {calendarSearchInput ? (
              <button
                type="button"
                onClick={clearCalendarSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)]"
                aria-label="Clear search"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => openScheduleModal()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--color-copper)] px-4 text-[13px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)]"
          >
            <IconPlus className="h-4 w-4 shrink-0" strokeWidth={2} />
            New
          </button>
        </>,
        topbarActionsNode,
      )
    : null;

  /* ── Render ──────────────────────────────────────────── */
  return (
    <>
      {topbarActions}
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
          color: var(--color-copper) !important;
        }

        /* Today "circle" on day number in week view */
        .gc-surface .fc-col-header-cell.fc-day-today .gc-day-num {
          background: var(--color-copper);
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
          --fc-today-bg-color: rgba(196, 92, 26, 0.04);
          --fc-now-indicator-color: #ea4335;
          --fc-small-font-size: 11px;
          --fc-border-color: var(--color-border);
          /* FullCalendar's own base CSS sets .fc-event-main/.fc-h-event text color from
             this var (default #fff, meant for the old solid-fill events) — override it
             so the inner elements don't render invisible white-on-cream text. */
          --fc-event-text-color: var(--color-copper);
        }

        /* ── Event harness — DO NOT override position/size, FC sets those ── */
        /* Only style the inner .fc-timegrid-event, not the harness wrapper   */
        .gc-surface .fc-timegrid-event {
          border-radius: 6px !important;
          border: none !important;
          border-left: 3px solid var(--color-copper) !important;
          background: var(--color-copper-tint) !important;
          color: var(--color-copper) !important;
          font-size: 11px !important;
          padding: 2px 6px !important;
          cursor: pointer;
          box-shadow: none;
          transition: filter .15s;
          overflow: hidden;
        }
        .gc-surface .fc-timegrid-event:hover { filter: brightness(0.97); }

        /* Inset (overlapping) events get a surface-color border so they visually separate */
        .gc-surface .fc-timegrid-event-harness-inset .fc-timegrid-event {
          box-shadow: inset 0 0 0 1.5px var(--color-surface) !important;
        }

        /* Generic .fc-event (covers daygrid month view + any other context) */
        .gc-surface .fc-event:not(.fc-timegrid-event) {
          border-radius: 6px !important;
          border: none !important;
          border-left: 3px solid var(--color-copper) !important;
          background: var(--color-copper-tint) !important;
          color: var(--color-copper) !important;
          font-size: 11px !important;
          cursor: pointer;
        }
        .gc-surface .fc-event-main { color: var(--color-copper) !important; }
        .gc-surface .fc-event-title { color: var(--color-copper) !important; font-weight: 600 !important; }
        .gc-surface .fc-event-time { color: var(--color-copper) !important; opacity: .85 !important; font-size: 10px !important; }

        /* All-day events */
        .gc-surface .fc-daygrid-event {
          border-radius: 6px !important;
          border: none !important;
          border-left: 3px solid var(--color-copper) !important;
          background: var(--color-copper-tint) !important;
          color: var(--color-copper) !important;
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
          background: var(--color-copper); color: white; font-weight: 700;
        }
        .gc-surface .fc-daygrid-day { min-height: 80px !important; }

        /* ── Select mirror ── */
        .gc-surface .fc-highlight {
          background: rgba(196, 92, 26, 0.12) !important;
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

        /* ── Calendar modals — retint the shared .btn-primary/.input-field/.btn-ghost
             classes from the app-wide blue accent to copper, scoped to this page only. ── */
        .gc-modal .btn-primary {
          background: var(--color-copper);
        }
        .gc-modal .btn-primary:hover:not(:disabled) {
          background: var(--color-copper-hover);
          box-shadow: 0 2px 6px rgba(196, 92, 26, 0.30), 0 1px 2px rgba(196, 92, 26, 0.20);
        }
        .gc-modal .btn-primary:active:not(:disabled) {
          background: var(--color-copper-hover);
        }
        .gc-modal .btn-ghost:active:not(:disabled) {
          background: var(--color-copper-tint);
        }
        .gc-modal .input-field:hover:not(:focus) {
          border-color: rgba(196, 92, 26, 0.35);
        }
        .gc-modal .input-field:focus {
          border-color: var(--color-copper);
          box-shadow: 0 0 0 3px var(--color-copper-tint);
        }
      `}</style>

      {/* ── Full-bleed master layout ───────────────────── */}
      <div className="-mx-4 -mt-[calc(56px+16px)] -mb-6 flex h-[calc(100dvh-56px-24px)] min-h-0 overflow-hidden md:-mx-6 md:-mt-6 md:h-[calc(100dvh-104px)]">

        {/* ── Calendar pane ─────────────────── */}
        <div className="flex flex-1 flex-col min-w-0 bg-[var(--color-surface)]">

          {/* ── Toolbar: Today + nav + title + view switcher (search & New live in the workspace topbar on desktop) ── */}
          <header className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 sm:flex-nowrap">
            {/* Mobile-only: "New" button (topbar action is desktop-only) */}
            <button
              onClick={() => openScheduleModal()}
              className="md:hidden flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--color-copper)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              <IconPlus className="h-3.5 w-3.5" /> New
            </button>

            <button
              data-testid="calendar-today-btn"
              onClick={goToday}
              className="h-9 shrink-0 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 text-[14px] font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]"
            >
              Today
            </button>
            <div className="flex shrink-0 gap-0.5">
              <button
                data-testid="calendar-prev-btn"
                onClick={goPrev}
                className="rounded-full p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
              >
                <IconChevronLeft className="h-4 w-4" />
              </button>
              <button
                data-testid="calendar-next-btn"
                onClick={goNext}
                className="rounded-full p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors"
              >
                <IconChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Title */}
            <h1 className="font-display min-w-0 flex-1 basis-full truncate text-[19px] font-bold tracking-tight text-[var(--color-text)] sm:basis-auto sm:text-[22px]">
              {viewTitle}
            </h1>

            {/* Error badge */}
            {error ? (
              <span title={error} className="max-w-[200px] shrink-0 truncate rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </span>
            ) : null}

            {/* Sync */}
            <button
              data-testid="calendar-sync-btn"
              onClick={() => void handleSync()}
              disabled={syncing || loadingEvents}
              className="shrink-0 rounded-full p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors disabled:opacity-40"
              title="Refresh events"
            >
              <IconRefresh className={`h-4 w-4 ${syncing || loadingEvents ? "animate-spin" : ""}`} />
            </button>

            {/* View switcher */}
            <div className="flex shrink-0 gap-0.5 rounded-xl bg-[var(--color-surface-2)] p-1">
              {(
                [
                  { v: "timeGridDay" as ViewType, label: "Day", short: "D" },
                  { v: "timeGridWeek" as ViewType, label: "Week", short: "W" },
                  { v: "dayGridMonth" as ViewType, label: "Month", short: "M" },
                ] as const
              ).map(({ v, label, short }) => (
                <button
                  key={v}
                  data-testid={`calendar-view-${v.replace("timeGrid", "").replace("dayGrid", "").toLowerCase()}`}
                  onClick={() => goView(v)}
                  className={[
                    "rounded-lg px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors sm:px-4",
                    currentView === v
                      ? "bg-[var(--color-copper)] text-white"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
                  ].join(" ")}
                >
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </header>

          {/* ── Search results (Google Calendar) or grid ── */}
          {calendarSearchQuery ? (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-2.5">
                <p className="text-sm text-[var(--color-text)]">
                  {searchLoading ? (
                    "Searching…"
                  ) : (
                    <>
                      {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for{" "}
                      <span className="font-medium">&ldquo;{calendarSearchQuery}&rdquo;</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {searchError ? (
                  <p className="px-4 py-8 text-center text-sm text-red-600 dark:text-red-400">
                    {searchError}
                  </p>
                ) : searchLoading ? (
                  <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                    Searching your calendar…
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                    No events found. Try a different keyword, guest name, or location.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {searchResults.map((ev) => (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => openSearchResult(ev)}
                          className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-[var(--color-surface-offset)] transition-colors"
                        >
                          <span className="text-sm font-medium text-[var(--color-text)]">
                            {ev.summary || "(untitled)"}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {formatEventWhen(ev)}
                          </span>
                          {meetUrlOf(ev) ? (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-copper)]">
                              <Video className="h-3 w-3" aria-hidden /> Google Meet
                            </span>
                          ) : null}
                          {ev.location ? (
                            <span className="truncate text-xs text-[var(--color-text-faint)]">
                              {ev.location}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
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
                      {arg.date.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span
                      className={[
                        "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold",
                        isToday
                          ? "bg-[var(--color-copper)] text-white"
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
          )}
        </div>
      </div>

      {/* ── Schedule meeting modal ─────────────────────── */}
      {scheduleOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div data-testid="calendar-schedule-modal" className="card gc-modal flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Schedule meeting</h3>
              <button data-testid="calendar-schedule-close" type="button" onClick={() => setScheduleOpen(false)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <input
                data-testid="calendar-event-title-input"
                type="text"
                placeholder="Meeting title *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field"
                autoFocus
              />
              <div>
                <RecipientField
                  placeholder="Guests (recruiters, contacts) — optional"
                  value={recruiterEmail}
                  onChange={setRecruiterEmail}
                  suggestions={recipientSuggestions}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  data-testid="calendar-allday-toggle"
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => {
                    setAllDay(e.target.checked);
                    // An all-day block (out of office, holiday …) rarely wants a video room.
                    if (e.target.checked) setAddMeet(false);
                    // Start the all-day range on the day already chosen.
                    if (e.target.checked && startDateTime) {
                      setStartDate(startDateTime.slice(0, 10));
                      setEndDate(endDateTime ? endDateTime.slice(0, 10) : startDateTime.slice(0, 10));
                    }
                  }}
                  className="h-4 w-4 accent-[var(--color-copper)]"
                />
                All day
              </label>
              {allDay ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">First day</label>
                    <input
                      data-testid="calendar-start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        if (endDate < e.target.value) setEndDate(e.target.value);
                      }}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Last day</label>
                    <input
                      data-testid="calendar-end-date"
                      type="date"
                      min={startDate || undefined}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="input-field"
                    />
                  </div>
                </div>
              ) : (
                <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Start</label>
                  <input
                    data-testid="calendar-start-datetime"
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
                    data-testid="calendar-end-datetime"
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
                <span className="self-center text-[10px] text-[var(--color-text-faint)]">
                  {mounted ? scheduleOpts.timeZone : ""}
                </span>
              </div>
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Repeat</span>
                <select
                  data-testid="calendar-recurrence-select"
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
              {recurrencePreset === "custom" ? (
                <CalendarRecurrenceEditor
                  spec={customSpec}
                  onChange={setCustomSpec}
                  startDate={allDay ? startDate : startDateTime.slice(0, 10)}
                  startWeekday={weekdayOf(allDay ? startDate : startDateTime)}
                  error={validateSpec(customSpec, allDay ? startDate : startDateTime.slice(0, 10))}
                />
              ) : null}
              {!allDay ? (
                <CalendarFreeBusyPanel
                  startIso={scheduleStartIso}
                  endIso={scheduleEndIso}
                  emails={scheduleGuestEmails}
                />
              ) : null}
              <input
                type="text"
                placeholder="Location or video call link (optional)"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="input-field"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  data-testid="calendar-schedule-add-meet"
                  type="checkbox"
                  checked={addMeet}
                  onChange={(e) => setAddMeet(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-copper)]"
                />
                <Video className="h-4 w-4 text-[var(--color-copper)]" aria-hidden />
                Add Google Meet video conferencing
              </label>
              <textarea
                rows={3}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-field resize-none"
              />
              <CalendarEventOptions value={scheduleOpts} onChange={setScheduleOpts} timed={!allDay} driveEnabled={isVisible("drive")} />
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Send invitations</span>
                <select
                  data-testid="calendar-notify-select"
                  value={notify}
                  onChange={(e) => setNotify(e.target.value as SendUpdates)}
                  className="input-field"
                >
                  <option value="all">Yes, email all guests</option>
                  <option value="externalOnly">Only guests outside my organization</option>
                  <option value="none">No, don&apos;t send emails</option>
                </select>
              </label>

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
              <button data-testid="calendar-schedule-cancel" type="button" onClick={() => setScheduleOpen(false)} className="btn-ghost">
                Cancel
              </button>
              <button
                data-testid="calendar-schedule-submit"
                type="button"
                disabled={!title || (allDay ? !startDate || !endDate : !startDateTime || !endDateTime)}
                onClick={() => void scheduleMeeting()}
                className="btn-primary"
              >
                Create event
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Event detail modal ─────────────────────────── */}
      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div className="card gc-modal flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden animate-scale-in">
            {/* Colored header strip */}
            <div className="flex items-center justify-between bg-[var(--color-copper)] px-5 py-3">
              <h3 className="text-base font-semibold text-white truncate pr-4">
                {selectedEvent.summary || "(untitled)"}
              </h3>
              <button
                data-testid="calendar-event-close"
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-full p-1 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto p-0">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 px-5 py-4 text-sm">
                <dt className="text-[var(--color-text-faint)] font-medium whitespace-nowrap">When</dt>
                <dd className="text-[var(--color-text)]">
                  {formatCalendarDateTime(selectedEvent.start?.dateTime || selectedEvent.start?.date || "")}
                  {" — "}
                  {formatCalendarDateTime(selectedEvent.end?.dateTime || selectedEvent.end?.date || "")}
                  {repeatLabelOf(selectedEvent) ? (
                    <span className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
                      <Repeat className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {repeatLabelOf(selectedEvent)}
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
                        extras
                        htmlLink={selectedEvent.htmlLink}
                      />
                    </dd>
                  </>
                ) : null}

                {meetUrlOf(selectedEvent) ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Meet</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <a
                        data-testid="calendar-join-meet"
                        href={meetUrlOf(selectedEvent)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      >
                        <Video className="h-3.5 w-3.5" aria-hidden />
                        Join with Google Meet
                      </a>
                      <button
                        type="button"
                        data-testid="calendar-copy-meet"
                        onClick={() => void copyMeetLink(meetUrlOf(selectedEvent)!)}
                        className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
                        title="Copy the meeting link"
                      >
                        {meetCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                        {meetCopied ? "Copied" : "Copy link"}
                      </button>
                      <span className="w-full break-all text-xs text-[var(--color-text-faint)]">
                        {meetUrlOf(selectedEvent)!.replace(/^https?:\/\//, "")}
                      </span>
                    </dd>
                  </>
                ) : selectedEvent.organizer?.self ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Meet</dt>
                    <dd>
                      <button
                        type="button"
                        data-testid="calendar-add-meet"
                        disabled={meetBusy}
                        onClick={() => void addMeetToEvent(selectedEvent)}
                        className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      >
                        <Video className="h-3.5 w-3.5" aria-hidden />
                        {meetBusy ? "Adding…" : "Add Google Meet video conferencing"}
                      </button>
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
                          className="text-[var(--color-copper)] hover:underline break-all"
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
                            rsvpIcon = "★"; rsvpColor = "text-[var(--color-copper)]"; rsvpLabel = "Organizer";
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
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-copper-tint)] text-[10px] font-bold text-[var(--color-copper)]">
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

                {selectedEvent.reminders?.useDefault === false ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Reminders</dt>
                    <dd className="text-[var(--color-text)]">
                      {selectedEvent.reminders.overrides?.length
                        ? selectedEvent.reminders.overrides
                            .map((o) => `${reminderLabel(o.minutes ?? 0)} (${o.method === "email" ? "email" : "notification"})`)
                            .join(" · ")
                        : "None"}
                    </dd>
                  </>
                ) : null}

                {VISIBILITY_TEXT[selectedEvent.visibility ?? ""] || selectedEvent.transparency === "transparent" ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Status</dt>
                    <dd className="text-[var(--color-text)]">
                      {[VISIBILITY_TEXT[selectedEvent.visibility ?? ""], selectedEvent.transparency === "transparent" ? "Shown as free" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </>
                ) : null}

                {selectedEvent.attachments?.length ? (
                  <>
                    <dt className="text-[var(--color-text-faint)] font-medium">Files</dt>
                    <dd>
                      <ul className="space-y-1">
                        {selectedEvent.attachments
                          .filter((a) => a.fileUrl)
                          .map((a) => (
                            <li key={a.fileUrl} className="flex items-center gap-1.5">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" aria-hidden />
                              <a href={a.fileUrl} target="_blank" rel="noreferrer" className="truncate text-[var(--color-copper)] hover:underline">
                                {a.title || a.fileUrl}
                              </a>
                            </li>
                          ))}
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
                <button data-testid="calendar-event-close-btn" type="button" onClick={() => setSelectedEvent(null)} className="btn-ghost">
                  Close
                </button>
                {isOrganizerOf(selectedEvent) || selectedEvent.guestsCanModify ? (
                  <button
                    data-testid="calendar-event-edit-btn"
                    type="button"
                    onClick={() => openEdit(selectedEvent)}
                    className="btn-secondary"
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  data-testid="calendar-event-duplicate-btn"
                  type="button"
                  onClick={() => duplicateEvent(selectedEvent)}
                  className="btn-ghost"
                  title="Make a copy of this event"
                >
                  Duplicate
                </button>
                <button
                  data-testid="calendar-event-delete-btn"
                  type="button"
                  onClick={() => openDeleteConfirm(selectedEvent)}
                  disabled={deleteBusy}
                  className="btn-ghost text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] disabled:opacity-50"
                  title={isOrganizerOf(selectedEvent) ? "Delete this meeting" : "Remove from your calendar or decline"}
                >
                  {deleteBusy ? "Working…" : isOrganizerOf(selectedEvent) ? "Delete" : "Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Edit event modal ───────────────────────────────── */}
      {editEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center animate-fade-in">
          <div className="card gc-modal flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Edit event</h3>
              <button type="button" onClick={() => setEditEvent(null)} className="btn-ghost p-1.5">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">First day</span>
                    <input
                      type="date"
                      value={editStartDate}
                      onChange={(e) => {
                        setEditStartDate(e.target.value);
                        if (editEndDate < e.target.value) setEditEndDate(e.target.value);
                      }}
                      className="input-field"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Last day</span>
                    <input
                      type="date"
                      min={editStartDate || undefined}
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                      className="input-field"
                    />
                  </label>
                </div>
              ) : (
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="datetime-local"
                      aria-label="Start"
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      className="input-field"
                    />
                    <input
                      type="datetime-local"
                      aria-label="End"
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">{mounted ? editOpts.timeZone : ""}</p>
                </div>
              )}

              {!editIsSeriesInstance ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Repeat</span>
                  <select
                    value={editRecurrencePreset}
                    onChange={(e) => setEditRecurrencePreset(e.target.value as RecurrencePreset)}
                    className="input-field"
                  >
                    {editRecurrencePreset === "keep" ? <option value="keep">Keep current repeat</option> : null}
                    {RECURRENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {editRecurrencePreset === "custom" ? (
                    <div className="mt-2">
                      <CalendarRecurrenceEditor
                        spec={editCustomSpec}
                        onChange={setEditCustomSpec}
                        startDate={editAllDay ? editStartDate : editStart.slice(0, 10)}
                        startWeekday={weekdayOf(editAllDay ? editStartDate : editStart)}
                        error={validateSpec(editCustomSpec, editAllDay ? editStartDate : editStart.slice(0, 10))}
                      />
                    </div>
                  ) : null}
                </label>
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

              <CalendarEventOptions
                value={editOpts}
                onChange={setEditOpts}
                timed={!editAllDay}
                driveEnabled={isVisible("drive")}
                hasGuests={extractAllEmailsFromText(editAttendees).length > 0}
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
                        ? "bg-[var(--color-copper-tint)]"
                        : "hover:bg-[var(--color-surface-offset)]",
                    ].join(" ")}
                  >
                    <span className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      editNotify === value
                        ? "border-[var(--color-copper)] bg-[var(--color-copper)]"
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
                disabled={!editTitle || (editAllDay ? !editStartDate || !editEndDate : !editStart || !editEnd)}
                onClick={requestSaveEdit}
                className="btn-primary"
              >
                {editNotify === "none" ? "Save quietly" : "Save & notify"}
              </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {askScope && editEvent ? (
        <CalendarScopeDialog
          title="Edit repeating event"
          confirmLabel="OK"
          onConfirm={(scope) => void saveEdit(scope)}
          onCancel={() => setAskScope(false)}
        />
      ) : null}

      {/* ── Delete / remove modal ──── */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div data-testid="calendar-delete-dialog" className="card gc-modal flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden animate-scale-in">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {isOrganizerOf(deleteTarget) ? "Delete meeting?" : "Remove from your calendar?"}
              </h3>
              <p className="mt-1 text-[13px] text-[var(--color-text-muted)] line-clamp-2">
                {deleteTarget.summary || "(untitled meeting)"}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {isRepeating(deleteTarget) ? <ScopeChoice value={deleteScope} onChange={setDeleteScope} name="delete-scope" /> : null}

              {isOrganizerOf(deleteTarget) ? (
                realGuests(deleteTarget).length > 0 ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-[var(--color-text-muted)]">
                        {realGuests(deleteTarget).length === 1 ? "1 guest" : `${realGuests(deleteTarget).length} guests`} — send a cancellation email?
                      </span>
                      <select
                        data-testid="calendar-delete-notify"
                        value={deleteNotify}
                        onChange={(e) => setDeleteNotify(e.target.value as SendUpdates)}
                        className="input-field"
                      >
                        <option value="all">Yes, email all guests</option>
                        <option value="externalOnly">Only guests outside my organization</option>
                        <option value="none">No, don&apos;t send emails</option>
                      </select>
                    </label>
                    {deleteNotify !== "none" ? (
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
                    ) : null}
                  </>
                ) : (
                  <p className="text-[13px] text-[var(--color-text)]">
                    {isRepeating(deleteTarget) ? "The selected events will be deleted." : "This meeting will be deleted."}
                  </p>
                )
              ) : (
                <p className="text-[13px] text-[var(--color-text)]">
                  You&apos;re a guest on this event. Removing it only takes it off your calendar — to let the organizer know
                  you can&apos;t make it, decline instead.
                </p>
              )}

              {deleteError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{deleteError}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button type="button" onClick={closeDeleteConfirm} disabled={deleteBusy} className="btn-ghost">
                Cancel
              </button>
              {!isOrganizerOf(deleteTarget) ? (
                <button
                  type="button"
                  data-testid="calendar-decline-instead"
                  onClick={() => void declineEvent(deleteTarget, deleteScope)}
                  disabled={deleteBusy || (isRepeating(deleteTarget) && deleteScope === "following")}
                  title={deleteScope === "following" && isRepeating(deleteTarget) ? "Choose “This event” or “All events” to decline" : undefined}
                  className="btn-secondary disabled:opacity-50"
                >
                  Decline
                </button>
              ) : null}
              <button
                type="button"
                data-testid="calendar-delete-confirm"
                onClick={() => void confirmDelete()}
                disabled={deleteBusy}
                className="rounded-[var(--radius-md)] bg-[var(--color-danger)] px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleteBusy ? "Working…" : isOrganizerOf(deleteTarget) ? "Delete" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Background save status ──── */}
      {toast ? (
        <div
          role="status"
          data-testid="calendar-toast"
          className={`fixed bottom-4 left-4 z-[70] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
            toast.tone === "error" ? "bg-[var(--color-danger)]" : "bg-[#323232]"
          }`}
        >
          <span>{toast.text}</span>
          {toast.tone !== "busy" ? (
            <button type="button" onClick={() => showToast(null)} className="shrink-0 text-white/70 hover:text-white" aria-label="Dismiss">
              <IconX className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Undo toast after a delete ──── */}
      {undoInfo ? (
        <div
          role="status"
          data-testid="calendar-undo-toast"
          className="fixed bottom-4 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-[#323232] px-4 py-2.5 text-sm text-white shadow-lg"
        >
          <span className="truncate">“{undoInfo.title}” deleted</span>
          <button
            type="button"
            data-testid="calendar-undo-btn"
            onClick={() => void undoDelete()}
            disabled={undoBusy}
            className="shrink-0 font-semibold text-[#8ab4f8] hover:underline disabled:opacity-50"
          >
            {undoBusy ? "Restoring…" : "Undo"}
          </button>
          <button type="button" onClick={() => setUndoInfo(null)} className="shrink-0 text-white/70 hover:text-white" aria-label="Dismiss">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </>
  );
}
