"use client";

import { Loader2 } from "lucide-react";
import { titleCase } from "@/lib/title-case";

/**
 * One file on its way in: name, percentage, a thin bar, and whether it is
 * becoming an attachment or a Google Drive link. The same row everywhere a file
 * is attached — compose, sequence steps and mail templates — so an upload
 * reads the same wherever it happens.
 *
 * "gmail" is the compose window's own palette; "app" uses the workspace tokens
 * (sequence editor, templates modal) so it themes with those pages.
 */
const THEMES = {
  gmail: {
    row: "rounded border border-[#c5e1f5] bg-[#e8f4fd]",
    spinner: "text-[#1a73e8]",
    name: "text-[#202124]",
    percent: "text-[#1a73e8]",
    track: "bg-[#d2e3fc]",
    bar: "bg-[#1a73e8]",
    status: "text-[#5f6368]",
  },
  app: {
    row: "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]",
    spinner: "text-[var(--color-copper)]",
    name: "text-[var(--color-text)]",
    percent: "text-[var(--color-copper)]",
    track: "bg-[var(--color-copper-tint)]",
    bar: "bg-[var(--color-copper)]",
    status: "text-[var(--color-text-faint)]",
  },
} as const;

export type AttachmentUploadKind = "attachment" | "drive" | "copy";

const STATUS: Record<AttachmentUploadKind, string> = {
  attachment: "Uploading attachment…",
  drive: "Uploading to Drive…",
  copy: "Adding from template…",
};

export function AttachmentUploadRow({
  name,
  percent,
  kind = "attachment",
  theme = "gmail",
}: {
  name: string;
  percent: number;
  kind?: AttachmentUploadKind;
  theme?: keyof typeof THEMES;
}) {
  const t = THEMES[theme];
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  const statusLabel = titleCase(STATUS[kind]);
  return (
    <div className={`px-2 py-2 text-[12px] ${t.row}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${t.spinner}`} />
        <span className={`min-w-0 flex-1 truncate font-medium ${t.name}`} title={name}>
          {name}
        </span>
        <span className={`shrink-0 tabular-nums text-[11px] font-medium ${t.percent}`}>{pct}%</span>
      </div>
      <div
        className={`h-1 overflow-hidden rounded-full ${t.track}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${statusLabel} ${pct}%`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${t.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1 text-[10px] ${t.status}`}>{statusLabel}</p>
    </div>
  );
}

/**
 * Drives a row for work with no byte count to report (a server-side copy):
 * creeps toward 90% and lets the caller finish it. Returns a stop function.
 */
export function creepProgress(onPercent: (percent: number) => void): () => void {
  let shown = 3;
  onPercent(shown);
  const timer = setInterval(() => {
    shown += (90 - shown) * 0.12;
    onPercent(shown);
  }, 250);
  return () => clearInterval(timer);
}
