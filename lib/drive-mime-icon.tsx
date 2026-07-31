"use client";

import { useState } from "react";
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  Music,
  Archive,
  Code,
  Folder,
} from "lucide-react";

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "tar",
  "gz",
  "tgz",
  "rar",
  "7z",
  "bz2",
  "xz",
  "zipx",
  "cab",
]);

function isArchiveMime(mimeType: string, ext: string): boolean {
  if (ARCHIVE_EXTENSIONS.has(ext)) return true;
  if (ext) return false;
  return (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("rar") ||
    mimeType === "application/gzip" ||
    mimeType === "application/x-gzip" ||
    mimeType === "application/x-7z-compressed"
  );
}
import { cn } from "@/lib/utils";

type Props = {
  mimeType: string;
  name?: string;
  thumbnailLink?: string;
  className?: string;
  iconClassName?: string;
  /** Bare icon, no colored badge background — matches the Drive list-view row style. */
  flat?: boolean;
};

type IconConfig = {
  icon: React.ReactNode;
  bg: string;
  iconColor: string;
  /** Shown as a small type label on the icon in grid view */
  label?: string;
};

function getConfig(mimeType: string, name?: string, iconSize = "h-4 w-4"): IconConfig {
  const ext = name?.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType === "application/vnd.google-apps.folder") {
    return {
      icon: <FolderShape className={iconSize} />,
      bg: "bg-amber-50 dark:bg-amber-950/30",
      iconColor: "text-amber-500",
    };
  }

  if (mimeType.startsWith("image/")) {
    return {
      icon: <FileImage className={iconSize} />,
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      label: "IMG",
    };
  }

  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    ext === "xlsx" || ext === "xls" || ext === "csv"
  ) {
    return {
      icon: <FileSpreadsheet className={iconSize} />,
      bg: "bg-green-50 dark:bg-green-950/30",
      iconColor: "text-green-700 dark:text-green-400",
      label: "XLS",
    };
  }

  if (
    mimeType.includes("presentation") ||
    mimeType.includes("powerpoint") ||
    ext === "pptx" || ext === "ppt"
  ) {
    return {
      icon: <Presentation className={iconSize} />,
      bg: "bg-orange-50 dark:bg-orange-950/30",
      iconColor: "text-orange-600 dark:text-orange-400",
      label: "PPT",
    };
  }

  if (mimeType === "application/pdf" || ext === "pdf") {
    return {
      icon: <FileText className={iconSize} />,
      bg: "bg-red-50 dark:bg-red-950/30",
      iconColor: "text-red-600 dark:text-red-400",
      label: "PDF",
    };
  }

  if (
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType.startsWith("text/") ||
    ext === "docx" || ext === "doc" || ext === "txt" || ext === "md"
  ) {
    return {
      icon: <FileText className={iconSize} />,
      bg: "bg-blue-50 dark:bg-blue-950/30",
      iconColor: "text-blue-600 dark:text-blue-400",
      label: "DOC",
    };
  }

  if (mimeType.startsWith("video/") || ext === "mp4" || ext === "mov" || ext === "avi") {
    return {
      icon: <FileVideo className={iconSize} />,
      bg: "bg-violet-50 dark:bg-violet-950/30",
      iconColor: "text-violet-600 dark:text-violet-400",
      label: "VID",
    };
  }

  if (mimeType.startsWith("audio/") || ext === "mp3" || ext === "wav" || ext === "aac") {
    return {
      icon: <Music className={iconSize} />,
      bg: "bg-pink-50 dark:bg-pink-950/30",
      iconColor: "text-pink-600 dark:text-pink-400",
      label: "AUD",
    };
  }

  if (isArchiveMime(mimeType, ext)) {
    return {
      icon: <Archive className={iconSize} />,
      bg: "bg-yellow-50 dark:bg-yellow-950/30",
      iconColor: "text-yellow-600 dark:text-yellow-500",
      label: "ZIP",
    };
  }

  if (
    mimeType.includes("javascript") || mimeType.includes("json") || mimeType.includes("html") ||
    ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx" || ext === "json" || ext === "html" || ext === "css"
  ) {
    return {
      icon: <Code className={iconSize} />,
      bg: "bg-slate-100 dark:bg-slate-800/50",
      iconColor: "text-slate-600 dark:text-slate-400",
      label: "CODE",
    };
  }

  return {
    icon: <UnknownFileShape className={iconSize} />,
    bg: "bg-[var(--color-surface-offset)]",
    iconColor: "text-[var(--color-text-muted)]",
  };
}

/** Google Drive–style generic file (folded-corner page, not an archive box). */
function UnknownFileShape({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M6 2h8l6 6v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="currentColor"
        opacity="0.85"
      />
      <path d="M14 2v6h6" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** Google Drive-style folder shape rendered as inline SVG for richness. */
function FolderShape({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Back panel (darker) */}
      <path
        d="M1 3.5C1 2.67 1.67 2 2.5 2H7.38L9 4H17.5C18.33 4 19 4.67 19 5.5V13.5C19 14.33 18.33 15 17.5 15H2.5C1.67 15 1 14.33 1 13.5V3.5Z"
        fill="currentColor"
        opacity="0.35"
      />
      {/* Front panel (brighter) */}
      <path
        d="M1 6.5C1 5.67 1.67 5 2.5 5H17.5C18.33 5 19 5.67 19 6.5V13.5C19 14.33 18.33 15 17.5 15H2.5C1.67 15 1 14.33 1 13.5V6.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Google Drive–style mime icon with colored badge background. */
export function DriveMimeIcon({
  mimeType,
  name,
  thumbnailLink,
  className,
  iconClassName = "h-4 w-4",
  flat,
}: Props) {
  const isFolder = mimeType === "application/vnd.google-apps.folder";

  // Google Drive thumbnailLink URLs are auth-gated — loading them directly in
  // an <img> often 403s cross-origin and renders a broken-image icon. Track
  // load failure and fall back to the colored type icon when that happens.
  const [thumbFailed, setThumbFailed] = useState(false);

  // Only bother attempting a thumbnail where a visual preview actually helps
  // (images/videos). PDFs, docs, etc. have clear colored type icons and never
  // produce a useful list thumbnail, so skip the doomed network request.
  const wantsThumbnail =
    mimeType.startsWith("image/") || mimeType.startsWith("video/");

  if (!isFolder && thumbnailLink && wantsThumbnail && !thumbFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailLink}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setThumbFailed(true)}
        className={cn("shrink-0 rounded-lg object-cover", className ?? "h-8 w-8")}
      />
    );
  }

  const cfg = getConfig(mimeType, name, iconClassName);

  if (flat) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          isFolder ? "text-[var(--color-copper)]" : cfg.iconColor,
          className ?? "h-8 w-8",
        )}
      >
        {isFolder ? <Folder className={iconClassName} strokeWidth={1.75} /> : cfg.icon}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        cfg.bg,
        cfg.iconColor,
        // If no className passed, give a sensible default size for list view
        className ?? "h-8 w-8",
      )}
    >
      {cfg.icon}
    </span>
  );
}
