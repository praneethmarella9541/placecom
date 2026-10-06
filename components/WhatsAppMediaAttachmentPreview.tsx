"use client";

import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { IconX } from "@/components/Icons";

export type AttachmentUploadStatus = "uploading" | "ready" | "failed";

export type PendingAttachment = {
  id: string;
  previewUrl: string;
  name: string;
  mimeType: string;
  isImage: boolean;
  status: AttachmentUploadStatus;
  remoteUrl?: string;
  kind?: string;
  filename?: string;
  error?: string;
};

const MAX_ATTACHMENTS = 30;

type Props = {
  attachments: PendingAttachment[];
  caption: string;
  onCaptionChange: (text: string) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
  onRetry: (id: string) => void;
  onAddMore: () => void;
};

function mediaLabel(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  return "Document";
}

export function WhatsAppMediaAttachmentPreview({
  attachments,
  caption,
  onCaptionChange,
  onRemove,
  onRemoveAll,
  onRetry,
  onAddMore,
}: Props) {
  const readyCount = attachments.filter((a) => a.status === "ready").length;
  const uploadingCount = attachments.filter((a) => a.status === "uploading").length;
  const singleImage = attachments.length === 1 && attachments[0]?.isImage ? attachments[0] : null;

  return (
    <div className="mb-2 rounded-xl border border-[var(--color-border)] bg-white/95 p-2 shadow-sm dark:bg-[#2a3942]">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
        <span>
          {attachments.length} {attachments.length === 1 ? "item" : "items"}
          {uploadingCount > 0 ? ` · ${uploadingCount} uploading` : ""}
          {readyCount > 0 && uploadingCount === 0 ? " · ready" : ""}
        </span>
        <div className="flex gap-2">
          {attachments.length < MAX_ATTACHMENTS ? (
            <button type="button" className="text-[#00a884] hover:underline" onClick={onAddMore}>
              {titleCase("Add")}
            </button>
          ) : null}
          <button type="button" className="text-red-600 hover:underline" onClick={onRemoveAll}>
            {titleCase("Clear")}
          </button>
        </div>
      </div>

      {singleImage ? (
        <div className="relative mx-auto max-h-48 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={singleImage.previewUrl} alt="" className="max-h-48 w-full object-contain" />
          {singleImage.status === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          ) : null}
          {singleImage.status === "failed" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 p-2 text-center text-xs text-white">
              <p>{singleImage.error || "Upload failed"}</p>
              <button type="button" className="rounded bg-white/20 px-2 py-1" onClick={() => onRetry(singleImage.id)}>
                {titleCase("Retry")}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white"
            onClick={() => onRemove(singleImage.id)}
            aria-label="Remove"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {attachments.map((item) => (
            <div
              key={item.id}
              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)]"
            >
              {item.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-1 text-center text-[10px] text-[var(--color-text-muted)]">
                  <span>{mediaLabel(item.mimeType)}</span>
                  <span className="mt-0.5 line-clamp-2">{item.name}</span>
                </div>
              )}
              {item.status === "uploading" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </div>
              ) : null}
              {item.status === "failed" ? (
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center bg-red-600/80 text-[9px] text-white"
                  onClick={() => onRetry(item.id)}
                >
                  {titleCase("Retry")}
                </button>
              ) : null}
              <button
                type="button"
                className="absolute right-0.5 top-0.5 rounded-full bg-black/50 p-0.5 text-white"
                onClick={() => onRemove(item.id)}
                aria-label="Remove"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          ))}
          {attachments.length < MAX_ATTACHMENTS ? (
            <button
              type="button"
              onClick={onAddMore}
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)]"
            >
              +
            </button>
          ) : null}
        </div>
      )}

      <input
        className={cn(
          "mt-2 w-full rounded-lg border-0 bg-[var(--color-surface-offset)] px-3 py-2 text-[14px] outline-none",
          "text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
        )}
        placeholder={
          attachments.length > 1 ? titleCase("Add a caption (sent with last item)") : titleCase("Add a caption")
        }
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
      />
    </div>
  );
}

export { MAX_ATTACHMENTS as WHATSAPP_MAX_ATTACHMENTS };
