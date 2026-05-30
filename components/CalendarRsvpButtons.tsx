"use client";

import { useState } from "react";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

export type RsvpStatus = "accepted" | "declined" | "tentative";

type Props = {
  eventId: string;
  currentStatus?: string;
  onUpdated?: (status: RsvpStatus) => void;
  className?: string;
  /** Gmail-style pill buttons vs compact toolbar buttons */
  variant?: "invite" | "detail";
};

export function CalendarRsvpButtons({
  eventId,
  currentStatus,
  onUpdated,
  className,
  variant = "detail",
}: Props) {
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(status: RsvpStatus) {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not save RSVP");
      onUpdated?.(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "RSVP failed");
    } finally {
      setBusy(null);
    }
  }

  const buttons: { status: RsvpStatus; label: string }[] = [
    { status: "accepted", label: titleCase("Yes") },
    { status: "declined", label: titleCase("No") },
    { status: "tentative", label: titleCase("Maybe") },
  ];

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map(({ status, label }) => {
          const active = currentStatus === status;
          const isBusy = busy === status;
          if (variant === "invite") {
            return (
              <button
                key={status}
                type="button"
                disabled={!!busy}
                onClick={() => void respond(status)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50",
                  active
                    ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                    : "border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f8f9fa]"
                )}
              >
                {isBusy ? "…" : label}
              </button>
            );
          }
          return (
            <button
              key={status}
              type="button"
              disabled={!!busy}
              onClick={() => void respond(status)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                active
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
              )}
            >
              {isBusy ? "Saving…" : label}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
