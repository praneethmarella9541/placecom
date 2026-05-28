"use client";

import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from "lucide-react";
import { IconFolder } from "@/components/Icons";
import { cn } from "@/lib/utils";

type Props = {
  mimeType: string;
  name?: string;
  thumbnailLink?: string;
  className?: string;
  iconClassName?: string;
};

/** Pick a lucide icon (or thumbnail) by Google Drive mime type. */
export function DriveMimeIcon({
  mimeType,
  name,
  thumbnailLink,
  className,
  iconClassName = "h-4 w-4",
}: Props) {
  const isFolder = mimeType === "application/vnd.google-apps.folder";

  if (!isFolder && thumbnailLink) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailLink}
        alt=""
        className={cn("h-8 w-8 shrink-0 rounded object-cover", className)}
      />
    );
  }

  const icon = pickIcon(mimeType, name);
  const color = isFolder
    ? "text-amber-600"
    : mimeType.startsWith("image/")
      ? "text-emerald-600"
      : mimeType.includes("spreadsheet") || mimeType.includes("excel")
        ? "text-green-700"
        : mimeType.includes("presentation") || mimeType.includes("powerpoint")
          ? "text-orange-600"
          : mimeType.includes("document") || mimeType.includes("word") || mimeType === "application/pdf"
            ? "text-blue-600"
            : mimeType.startsWith("video/")
              ? "text-violet-600"
              : "text-zinc-500";

  return (
    <span className={cn("flex shrink-0 items-center justify-center", className)}>
      {isFolder ? (
        <IconFolder className={cn(iconClassName, color)} />
      ) : (
        <span className={color}>{icon}</span>
      )}
    </span>
  );
}

function pickIcon(mimeType: string, name?: string) {
  const ext = name?.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) return <FileImage className="h-4 w-4" />;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  ) {
    return <FileSpreadsheet className="h-4 w-4" />;
  }
  if (
    mimeType.includes("presentation") ||
    mimeType.includes("powerpoint") ||
    ext === "pptx" ||
    ext === "ppt"
  ) {
    return <Presentation className="h-4 w-4" />;
  }
  if (
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    ext === "docx" ||
    ext === "doc" ||
    ext === "pdf"
  ) {
    return <FileText className="h-4 w-4" />;
  }
  if (mimeType.startsWith("video/")) return <FileVideo className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
}
