"use client";

import { IconCheck } from "@/components/Icons";
import { DRAFT_AUTOSAVE_DELAY_MS, type ComposeDraftSaveStatus } from "@/lib/gmail-draft-autosave";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type Props = {
  status: ComposeDraftSaveStatus;
  /** Bumps when the debounce timer restarts so the progress bar resets. */
  progressKey: number;
  delayMs?: number;
  className?: string;
};

/**
 * Small status chip in the compose header: countdown → saving → saved.
 */
export function ComposeDraftSaveIndicator({
  status,
  progressKey,
  delayMs = DRAFT_AUTOSAVE_DELAY_MS,
  className,
}: Props) {
  if (status === "idle") return null;

  const delaySec = Math.max(1, Math.round(delayMs / 1000));

  return (
    <div
      className={cn("flex shrink-0 flex-col items-end gap-0.5", className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {status === "pending" && (
        <>
          <span className="whitespace-nowrap text-[10px] font-medium leading-none text-white/85">
            {titleCase(`Saves in ~${delaySec}s when you pause`)}
          </span>
          <div className="h-0.5 w-[88px] overflow-hidden rounded-full bg-white/25">
            <div
              key={progressKey}
              className="h-full rounded-full bg-white/90"
              style={{
                width: "0%",
                animation: `compose-draft-autosave ${delayMs}ms linear forwards`,
              }}
            />
          </div>
        </>
      )}
      {status === "saving" && (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium text-white/90">
          <svg className="h-3 w-3 shrink-0 animate-spin text-white/70" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          {titleCase("Saving draft…")}
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-emerald-200">
          <IconCheck className="h-3 w-3 shrink-0" />
          {titleCase("Draft saved")}
        </span>
      )}
      {status === "error" && (
        <span className="whitespace-nowrap text-[10px] font-medium text-amber-200">
          {titleCase("Couldn't save draft")}
        </span>
      )}
    </div>
  );
}
