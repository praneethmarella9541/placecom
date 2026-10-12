"use client";

import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type Freq,
  type RecurrenceSpec,
  type Weekday,
} from "@/lib/calendar-recurrence";

const UNITS: { value: Freq; one: string; many: string }[] = [
  { value: "DAILY", one: "day", many: "days" },
  { value: "WEEKLY", one: "week", many: "weeks" },
  { value: "MONTHLY", one: "month", many: "months" },
  { value: "YEARLY", one: "year", many: "years" },
];

type Props = {
  spec: RecurrenceSpec;
  onChange: (spec: RecurrenceSpec) => void;
  /** First day of the event, "YYYY-MM-DD" — the earliest the repeat can end. */
  startDate: string;
  /** Weekday of the first day, preselected when switching to weekly. */
  startWeekday?: Weekday;
  error?: string | null;
};

/** Google-Calendar-style "Custom repeat": every N units, weekdays (weekly), and when it ends. */
export default function CalendarRecurrenceEditor({ spec, onChange, startDate, startWeekday, error }: Props) {
  const set = (patch: Partial<RecurrenceSpec>) => onChange({ ...spec, ...patch });
  const endType = spec.end.type;

  function setFreq(freq: Freq) {
    const byDay = freq === "WEEKLY" ? (spec.byDay.length ? spec.byDay : startWeekday ? [startWeekday] : []) : [];
    set({ freq, byDay });
  }

  function toggleDay(d: Weekday) {
    const byDay = spec.byDay.includes(d) ? spec.byDay.filter((x) => x !== d) : [...spec.byDay, d];
    set({ byDay });
  }

  return (
    <div
      data-testid="calendar-custom-repeat"
      className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-text-muted)]">Repeat every</span>
        <input
          type="number"
          min={1}
          max={99}
          value={Number.isFinite(spec.interval) ? spec.interval : ""}
          onChange={(e) => set({ interval: e.target.value === "" ? NaN : Number(e.target.value) })}
          className="input-field !w-16"
          aria-label="Repeat every"
          data-testid="calendar-custom-interval"
        />
        <select
          value={spec.freq}
          onChange={(e) => setFreq(e.target.value as Freq)}
          className="input-field !w-auto"
          aria-label="Repeat unit"
          data-testid="calendar-custom-unit"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {spec.interval === 1 ? u.one : u.many}
            </option>
          ))}
        </select>
      </div>

      {spec.freq === "WEEKLY" ? (
        <div>
          <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Repeat on</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = spec.byDay.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`h-8 min-w-[2.5rem] rounded-full border px-2 text-xs font-medium transition-colors ${
                    on
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                  }`}
                >
                  {WEEKDAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]">Ends</span>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="rec-end" checked={endType === "never"} onChange={() => set({ end: { type: "never" } })} />
            Never
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input
              type="radio"
              name="rec-end"
              checked={endType === "until"}
              onChange={() => set({ end: { type: "until", date: spec.end.type === "until" ? spec.end.date : startDate } })}
            />
            On
            <input
              type="date"
              min={startDate || undefined}
              value={spec.end.type === "until" ? spec.end.date : ""}
              disabled={endType !== "until"}
              onChange={(e) => set({ end: { type: "until", date: e.target.value } })}
              className="input-field !w-auto"
              aria-label="Repeat ends on"
            />
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input
              type="radio"
              name="rec-end"
              checked={endType === "count"}
              onChange={() => set({ end: { type: "count", count: spec.end.type === "count" ? spec.end.count : 10 } })}
            />
            After
            <input
              type="number"
              min={1}
              max={999}
              value={spec.end.type === "count" && Number.isFinite(spec.end.count) ? spec.end.count : ""}
              disabled={endType !== "count"}
              onChange={(e) => set({ end: { type: "count", count: e.target.value === "" ? NaN : Number(e.target.value) } })}
              className="input-field !w-20"
              aria-label="Number of occurrences"
            />
            occurrences
          </label>
        </div>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
