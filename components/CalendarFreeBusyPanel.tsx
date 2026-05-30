"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCalendarDateTime } from "@/lib/utils";

type BusySlot = { start: string; end: string };

type Props = {
  startIso: string | null;
  endIso: string | null;
  emails: string[];
  className?: string;
};

function slotsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function CalendarFreeBusyPanel({ startIso, endIso, emails, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [busyByCalendar, setBusyByCalendar] = useState<Record<string, BusySlot[]>>({});
  const [fetchError, setFetchError] = useState<string | null>(null);

  const uniqueEmails = useMemo(
    () =>
      Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))).slice(
        0,
        12
      ),
    [emails]
  );

  useEffect(() => {
    if (!startIso || !endIso || uniqueEmails.length === 0) {
      setBusyByCalendar({});
      setFetchError(null);
      return;
    }
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      setBusyByCalendar({});
      return;
    }

    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setFetchError(null);
      fetch("/api/calendar/freebusy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: new Date(startMs - 60 * 60_000).toISOString(),
          timeMax: new Date(endMs + 60 * 60_000).toISOString(),
          emails: uniqueEmails,
        }),
      })
        .then(async (res) => {
          const body = (await res.json()) as {
            calendars?: Record<string, { busy?: BusySlot[] }>;
            error?: string;
          };
          if (!res.ok) throw new Error(body.error || "Could not check availability");
          if (cancelled) return;
          const next: Record<string, BusySlot[]> = {};
          for (const [id, data] of Object.entries(body.calendars ?? {})) {
            next[id] = data.busy ?? [];
          }
          setBusyByCalendar(next);
        })
        .catch((e) => {
          if (!cancelled) {
            setBusyByCalendar({});
            setFetchError(e instanceof Error ? e.message : "Availability check failed");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [startIso, endIso, uniqueEmails]);

  const conflicts = useMemo(() => {
    if (!startIso || !endIso) return [];
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];

    const out: { email: string; slots: BusySlot[] }[] = [];
    for (const email of uniqueEmails) {
      const busy =
        busyByCalendar[email] ??
        busyByCalendar[email.toLowerCase()] ??
        [];
      const overlapping = busy.filter((slot) => {
        const b0 = Date.parse(slot.start);
        const b1 = Date.parse(slot.end);
        return !Number.isNaN(b0) && !Number.isNaN(b1) && slotsOverlap(startMs, endMs, b0, b1);
      });
      if (overlapping.length > 0) out.push({ email, slots: overlapping });
    }
    return out;
  }, [startIso, endIso, uniqueEmails, busyByCalendar]);

  if (!startIso || !endIso || uniqueEmails.length === 0) return null;

  return (
    <div
      className={[
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2.5 text-xs",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="mb-1.5 font-semibold text-[var(--color-text-muted)]">Guest availability</p>
      {loading ? (
        <p className="text-[var(--color-text-faint)]">Checking calendars…</p>
      ) : fetchError ? (
        <p className="text-[var(--color-text-faint)]">{fetchError}</p>
      ) : conflicts.length === 0 ? (
        <p className="text-[var(--color-success)]">No scheduling conflicts detected for this time.</p>
      ) : (
        <ul className="space-y-2">
          {conflicts.map(({ email, slots }) => (
            <li key={email}>
              <p className="font-medium text-[var(--color-warning)]">{email} — busy</p>
              <ul className="mt-0.5 space-y-0.5 text-[var(--color-text-muted)]">
                {slots.slice(0, 3).map((slot, i) => (
                  <li key={i}>
                    {formatCalendarDateTime(slot.start)} – {formatCalendarDateTime(slot.end)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
