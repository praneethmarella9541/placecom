"use client";

import { Loader2, Paperclip } from "lucide-react";
import { IconX } from "@/components/Icons";
import {
  formatBytes,
  pendingFileName,
  pendingFileSize,
  type PendingFile,
} from "@/lib/gmail-compose-types";
import type { DriveUploadProgressMap } from "@/lib/upload-large-file-to-drive";
import { titleCase } from "@/lib/title-case";

type GmailPendingAttachmentsProps = {
  files: PendingFile[];
  driveUploadProgress: DriveUploadProgressMap;
  onRemove: (index: number) => void;
};

/** Gmail-style attachment chips (regular files + Drive links + upload progress). */
export function GmailPendingAttachments({
  files,
  driveUploadProgress,
  onRemove,
}: GmailPendingAttachmentsProps) {
  const uploading = Object.entries(driveUploadProgress);
  if (files.length === 0 && uploading.length === 0) return null;

  return (
    <div className="border-t border-[#f1f3f4] px-3 py-2">
      <ul className="flex flex-col gap-1.5">
        {uploading.map(([name, percent]) => (
          <li
            key={`uploading-${name}`}
            className="rounded border border-[#c5e1f5] bg-[#e8f4fd] px-2 py-2 text-[12px]"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#1a73e8]" />
              <span className="min-w-0 flex-1 truncate font-medium text-[#202124]" title={name}>
                {name}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] font-medium text-[#1a73e8]">
                {percent}%
              </span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-[#d2e3fc]"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${titleCase("Uploading to Drive")} ${percent}%`}
            >
              <div
                className="h-full rounded-full bg-[#1a73e8] transition-[width] duration-200 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-[#5f6368]">{titleCase("Uploading to Drive…")}</p>
          </li>
        ))}
        {files.map((f, i) => (
          <li
            key={i}
            className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[12px] ${
              f.kind === "drive" ? "border-[#c5e1f5] bg-[#e8f4fd]" : "border-[#dadce0] bg-[#f8f9fa]"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {f.kind === "drive" ? (
                <DriveIcon />
              ) : (
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#5f6368]" strokeWidth={2} />
              )}
              <span className="truncate font-medium">{pendingFileName(f)}</span>
              <span className="shrink-0 text-[#5f6368]">({formatBytes(pendingFileSize(f))})</span>
              {f.kind === "drive" && (
                <span className="shrink-0 rounded bg-[#1a73e8] px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {titleCase("Drive link")}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              aria-label={titleCase("Remove attachment")}
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DriveIcon() {
  return (
    <svg viewBox="0 0 87.3 78" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a7.3 7.3 0 003.3 3.3z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2a7.2 7.2 0 00-3.3 3.3L.95 50.5H27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25a7.3 7.3 0 000-7.3H60.5l5.85 12.35z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M60.5 50.5H27.5L13.75 74.3c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.05l-14.3-24.8a7.2 7.2 0 00-1.7-1.1L43.65 25l16.85 25.5h26.45a7.3 7.3 0 00-.95-3.65z" fill="#ffba00" />
    </svg>
  );
}
