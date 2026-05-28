"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, FileText, Film, ImageIcon, Music, Presentation } from "lucide-react";
import { IconDownload, IconEye, IconFile, IconX } from "@/components/Icons";
import {
  attachmentAccent,
  attachmentKind,
  formatAttachmentBytes,
  gmailAttachmentUrl,
  isOfficeFile,
  isPreviewable,
  type AttachmentKind,
  type GmailAttachment,
} from "@/lib/gmail-attachment-utils";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type GmailAttachmentPreviewsProps = {
  attachments: GmailAttachment[];
  messageId: string;
};

/** Gmail-style attachment strip with thumbnail cards and lightbox preview. */
export function GmailAttachmentPreviews({ attachments, messageId }: GmailAttachmentPreviewsProps) {
  const [preview, setPreview] = useState<GmailAttachment | null>(null);
  if (!attachments.length) return null;

  const countLabel =
    attachments.length === 1
      ? titleCase("1 attachment")
      : titleCase(`${attachments.length} attachments`);

  return (
    <>
      <div className="mt-4 border-t border-[#e8eaed] pt-4">
        <p className="mb-3 text-[13px] text-[#5f6368]">{countLabel}</p>

        <div className="flex gap-3 overflow-x-auto pb-1">
          {attachments.map((a, i) => (
            <AttachmentPreviewCard
              key={`${a.attachmentId}-${i}`}
              attachment={a}
              messageId={messageId}
              onPreview={() => setPreview(a)}
            />
          ))}
        </div>
      </div>

      {preview && (
        <AttachmentPreviewModal
          attachment={preview}
          messageId={messageId}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function AttachmentPreviewCard({
  attachment,
  messageId,
  onPreview,
}: {
  attachment: GmailAttachment;
  messageId: string;
  onPreview: () => void;
}) {
  const kind = attachmentKind(attachment.mimeType, attachment.filename);
  const accent = attachmentAccent(kind);
  const url = gmailAttachmentUrl(messageId, attachment);
  const downloadUrl = gmailAttachmentUrl(messageId, attachment, true);
  const canPreview = isPreviewable(attachment.mimeType, attachment.filename);
  const isImage = kind === "image";

  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const showImageThumb = isImage && !imgFailed;

  return (
    <div
      className={cn(
        "group relative shrink-0 overflow-hidden rounded border border-[#dadce0] bg-white shadow-sm transition hover:shadow-md",
        isImage ? "h-[126px] w-[168px]" : "h-[126px] w-[168px]"
      )}
    >
      <button
        type="button"
        className="flex h-full w-full flex-col text-left"
        onClick={() => (canPreview ? onPreview() : undefined)}
        disabled={!canPreview}
        title={attachment.filename}
      >
        <div
          className={cn(
            "relative flex flex-1 items-center justify-center overflow-hidden",
            !isImage && accent.surface,
            isImage && "bg-[#f1f3f4]"
          )}
        >
          {showImageThumb ? (
            <>
              {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-[#e8eaed]" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                loading="lazy"
                className={cn(
                  "h-full w-full object-cover transition-opacity",
                  imgLoaded ? "opacity-100" : "opacity-0"
                )}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgFailed(true)}
              />
            </>
          ) : (
            <NonImageThumbnail kind={kind} filename={attachment.filename} />
          )}

          {accent.grid && (
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "linear-gradient(#c5d9f7 1px, transparent 1px), linear-gradient(90deg, #c5d9f7 1px, transparent 1px)",
                backgroundSize: "10px 10px",
              }}
            />
          )}

          <CornerFold color={accent.fold} />
        </div>

        {!isImage && (
          <div className="relative z-[1] flex h-[32px] shrink-0 items-center gap-1.5 border-t border-[#e8eaed] bg-white px-2">
            <KindIcon kind={kind} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#202124]">
              {attachment.filename}
            </span>
          </div>
        )}
      </button>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition group-hover:pointer-events-auto group-hover:bg-black/35 group-hover:opacity-100">
        {canPreview && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[#5f6368] shadow hover:bg-white"
            title={titleCase("Preview")}
          >
            <IconEye className="h-4 w-4" />
          </button>
        )}
        <a
          href={downloadUrl}
          download={attachment.filename}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[#5f6368] shadow hover:bg-white"
          title={titleCase("Download")}
        >
          <IconDownload className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function CornerFold({ color }: { color: string }) {
  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 z-[2] h-0 w-0"
      style={{
        borderStyle: "solid",
        borderWidth: "0 0 14px 14px",
        borderColor: `transparent transparent ${color} transparent`,
      }}
      aria-hidden
    />
  );
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const cls = cn(className, "text-[#5f6368]");
  switch (kind) {
    case "spreadsheet":
      return <FileSpreadsheet className={cn(cls, "text-[#188038]")} strokeWidth={2} />;
    case "presentation":
      return <Presentation className={cn(cls, "text-[#f9ab00]")} strokeWidth={2} />;
    case "document":
      return <FileText className={cn(cls, "text-[#4285f4]")} strokeWidth={2} />;
    case "pdf":
      return <FileText className={cn(cls, "text-[#d93025]")} strokeWidth={2} />;
    case "video":
      return <Film className={cls} strokeWidth={2} />;
    case "audio":
      return <Music className={cls} strokeWidth={2} />;
    case "image":
      return <ImageIcon className={cls} strokeWidth={2} />;
    default:
      return <IconFile className={cls} />;
  }
}

function NonImageThumbnail({ kind, filename }: { kind: AttachmentKind; filename: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 text-center">
      <KindIcon kind={kind} className="h-10 w-10" />
      <span className="line-clamp-2 max-w-[140px] text-[10px] leading-tight text-[#5f6368]">
        {filename}
      </span>
    </div>
  );
}

function AttachmentPreviewModal({
  attachment,
  messageId,
  onClose,
}: {
  attachment: GmailAttachment;
  messageId: string;
  onClose: () => void;
}) {
  const url = gmailAttachmentUrl(messageId, attachment);
  const downloadUrl = gmailAttachmentUrl(messageId, attachment, true);
  const mime = attachment.mimeType;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string[][] | null>(null);

  const isPdf = mime === "application/pdf";
  const isCsv = mime === "text/csv" || attachment.filename.toLowerCase().endsWith(".csv");
  const isText = mime.startsWith("text/") && !isCsv;

  useEffect(() => {
    if (!isPdf && !isCsv) return;
    setBlobLoading(true);
    setBlobError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (isCsv) {
          const text = await res.text();
          const rows = text.trim().split(/\r?\n/).map((line) => {
            const cols: string[] = [];
            let cur = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') inQuotes = !inQuotes;
              else if (ch === "," && !inQuotes) {
                cols.push(cur);
                cur = "";
              } else cur += ch;
            }
            cols.push(cur);
            return cols;
          });
          setCsvContent(rows);
        } else {
          const blob = await res.blob();
          setBlobUrl(URL.createObjectURL(blob));
        }
      })
      .catch((e) => setBlobError(e?.message ?? "Failed to load"))
      .finally(() => setBlobLoading(false));

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isPdf, isCsv]);

  const kind = attachmentKind(mime, attachment.filename);

  const renderPreview = () => {
    if (mime.startsWith("image/")) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={attachment.filename} className="max-h-full max-w-full object-contain rounded" />
      );
    }
    if (mime.startsWith("video/")) {
      return (
        <video controls className="max-h-full max-w-full rounded" src={url}>
          Your browser does not support video preview.
        </video>
      );
    }
    if (mime.startsWith("audio/")) {
      return (
        <div className="flex flex-col items-center gap-4 p-8">
          <Music className="h-12 w-12 text-white/80" />
          <p className="text-sm font-medium text-white">{attachment.filename}</p>
          <audio controls src={url} className="w-full max-w-sm" />
        </div>
      );
    }
    if (isPdf) {
      if (blobLoading) return <LoadingState label="Loading PDF…" />;
      if (blobError || !blobUrl) return <DownloadFallback downloadUrl={downloadUrl} filename={attachment.filename} label="PDF" />;
      return <iframe src={blobUrl} title={attachment.filename} className="h-full w-full rounded border-0" />;
    }
    if (isCsv) {
      if (blobLoading) return <LoadingState label="Loading spreadsheet…" />;
      if (blobError || !csvContent) {
        return <DownloadFallback downloadUrl={downloadUrl} filename={attachment.filename} label="CSV" />;
      }
      const headers = csvContent[0] ?? [];
      const rows = csvContent.slice(1);
      return (
        <div className="h-full w-full overflow-auto rounded bg-white p-1">
          <table className="min-w-full border-collapse text-[12px] text-[#202124]">
            <thead>
              <tr className="bg-[#f1f3f4]">
                {headers.map((h, i) => (
                  <th key={i} className="border border-[#dadce0] px-3 py-2 text-left font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "" : "bg-[#f8f9fa]"}>
                  {headers.map((_, ci) => (
                    <td key={ci} className="max-w-[300px] truncate border border-[#dadce0] px-3 py-1.5 whitespace-nowrap">
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (isText) {
      return <iframe src={url} title={attachment.filename} className="h-full w-full rounded border-0 bg-white" />;
    }
    if (isOfficeFile(mime, attachment.filename)) {
      return (
        <div className="flex flex-col items-center gap-5 p-12 text-center">
          <KindIcon kind={kind} className="h-16 w-16" />
          <p className="text-base font-semibold text-white">{attachment.filename}</p>
          <p className="text-sm text-white/60">This file type cannot be previewed in the browser.</p>
          <a
            href={downloadUrl}
            download={attachment.filename}
            className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/30"
          >
            <IconDownload className="h-4 w-4" /> {titleCase("Download to open")}
          </a>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-4 p-12 text-center">
        <KindIcon kind={kind} className="h-14 w-14" />
        <p className="text-sm text-white/70">Preview not available for this file type.</p>
        <a
          href={downloadUrl}
          download={attachment.filename}
          className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30"
        >
          <IconDownload className="h-4 w-4" /> {titleCase("Download")}
        </a>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon kind={kind} className="h-4 w-4" />
          <span className="truncate text-sm font-medium text-white">{attachment.filename}</span>
          <span className="shrink-0 text-xs text-white/50">{formatAttachmentBytes(attachment.size)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={downloadUrl}
            download={attachment.filename}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            <IconDownload className="h-3.5 w-3.5" /> {titleCase("Download")}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4" onClick={(e) => e.stopPropagation()}>
        {renderPreview()}
      </div>
    </div>,
    document.body
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-white/70">
      <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function DownloadFallback({
  downloadUrl,
  filename,
  label,
}: {
  downloadUrl: string;
  filename: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 p-12 text-center">
      <p className="text-sm text-white/70">Could not load {label} preview.</p>
      <a
        href={downloadUrl}
        download={filename}
        className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30"
      >
        <IconDownload className="h-4 w-4" /> {titleCase("Download")}
      </a>
    </div>
  );
}
