"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { IconX } from "@/components/Icons";
import { DriveMimeIcon } from "@/lib/drive-mime-icon";
import { formatDate } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

type DriveDetails = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  starred?: boolean;
  shared?: boolean;
  viewedByMeTime?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string; me?: boolean }>;
  thumbnailLink?: string;
};

type Props = {
  fileId: string;
  onClose: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Google Drive–style details sidebar for the selected file. */
export function DriveDetailsPanel({ fileId, onClose }: Props) {
  const [details, setDetails] = useState<DriveDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/drive/file/${encodeURIComponent(fileId)}?details=1`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { file?: DriveDetails; error?: string };
        if (!r.ok) throw new Error(j.error || "Failed to load details");
        return j.file ?? null;
      })
      .then((file) => {
        if (!cancelled) setDetails(file);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const isFolder = details?.mimeType === "application/vnd.google-apps.folder";
  const sizeNum = details?.size ? parseInt(details.size, 10) : NaN;
  const owner =
    details?.owners?.find((o) => o.me) ??
    details?.owners?.[0];

  return (
    <aside className="flex w-full max-w-[320px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] sm:w-[280px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-[14px] font-semibold text-[var(--color-text)]">
          {titleCase("Details")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost rounded-full p-1.5"
          aria-label={titleCase("Close")}
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
        ) : details ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <DriveMimeIcon
                mimeType={details.mimeType}
                name={details.name}
                thumbnailLink={details.thumbnailLink}
                className="h-16 w-16"
                iconClassName="h-10 w-10"
              />
              <p className="line-clamp-3 w-full break-words text-[14px] font-medium text-[var(--color-text)]">
                {details.name}
              </p>
            </div>

            <dl className="space-y-3 text-[13px]">
              <DetailRow
                label={titleCase("Type")}
                value={isFolder ? "Folder" : mimeLabel(details.mimeType)}
              />
              {owner && (
                <DetailRow
                  label={titleCase("Owner")}
                  value={owner.displayName || owner.emailAddress || "—"}
                />
              )}
              {details.modifiedTime && (
                <DetailRow
                  label={titleCase("Modified")}
                  value={formatDate(details.modifiedTime)}
                />
              )}
              {details.createdTime && (
                <DetailRow
                  label={titleCase("Created")}
                  value={formatDate(details.createdTime)}
                />
              )}
              {details.viewedByMeTime && (
                <DetailRow
                  label={titleCase("Opened")}
                  value={formatDate(details.viewedByMeTime)}
                />
              )}
              {!isFolder && !Number.isNaN(sizeNum) && (
                <DetailRow label={titleCase("Size")} value={formatBytes(sizeNum)} />
              )}
              <DetailRow
                label={titleCase("Starred")}
                value={details.starred ? "Yes" : "No"}
              />
              {details.shared !== undefined && (
                <DetailRow
                  label={titleCase("Shared")}
                  value={details.shared ? "Yes" : "No"}
                />
              )}
            </dl>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-faint)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function mimeLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.includes("spreadsheet")) return "Spreadsheet";
  if (mimeType.includes("document")) return "Document";
  if (mimeType.includes("presentation")) return "Presentation";
  const short = mimeType.split("/").pop();
  return short ? short.replace(/[._-]/g, " ") : mimeType;
}
