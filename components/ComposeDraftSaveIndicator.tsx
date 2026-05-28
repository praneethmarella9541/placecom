"use client";

import { IconCheck } from "@/components/Icons";
import type { ComposeDraftSaveStatus } from "@/lib/gmail-draft-autosave";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type Props = {
  status: ComposeDraftSaveStatus;
  className?: string;
};

/** Compose header chip — only visible while saving or right after save/error. */
export function ComposeDraftSaveIndicator({ status, className }: Props) {
  if (status === "idle") return null;

  return (
    <div
      className={cn("flex shrink-0 items-center", className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {status === "saving" && (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium text-[#202124]">
          <svg className="h-3 w-3 shrink-0 animate-spin text-[#5f6368]" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          {titleCase("Saving draft…")}
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-[#202124]">
          <IconCheck className="h-3 w-3 shrink-0 text-[#202124]" />
          {titleCase("Draft saved")}
        </span>
      )}
      {status === "error" && (
        <span className="whitespace-nowrap text-[10px] font-medium text-[#202124]">
          {titleCase("Couldn't save draft")}
        </span>
      )}
    </div>
  );
}
