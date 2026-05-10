"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import {
  IconSearch,
  IconRefresh,
  IconFolder,
  IconFile,
  IconChevronRight,
  IconDownload,
  IconX,
} from "@/components/Icons";
import { supportsInAppPreview } from "@/lib/drive-file-proxy";

type DriveFileRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

type PathCrumb = { id: string; name: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DrivePage() {
  /** Folder path from My Drive root; empty = root. */
  const [pathStack, setPathStack] = useState<PathCrumb[]>([]);
  const currentParentId = pathStack.length === 0 ? "root" : pathStack[pathStack.length - 1].id;

  const [driveFiles, setDriveFiles] = useState<DriveFileRow[]>([]);
  const [driveNextPageToken, setDriveNextPageToken] = useState<string | undefined>();
  const [loadingDrive, setLoadingDrive] = useState(true);
  const [driveListError, setDriveListError] = useState<string | null>(null);
  const [driveSearchInput, setDriveSearchInput] = useState("");
  const [driveSearch, setDriveSearch] = useState("");

  const [previewFile, setPreviewFile] = useState<DriveFileRow | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDriveSearch(driveSearchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [driveSearchInput]);

  const loadDriveFiles = useCallback(
    async (opts: { append: boolean; pageToken?: string }) => {
      if (!opts.append) {
        setLoadingDrive(true);
        setDriveListError(null);
      }
      const params = new URLSearchParams({
        pageSize: "30",
        parent: currentParentId,
      });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (driveSearch) params.set("search", driveSearch);
      try {
        const res = await fetch(`/api/drive/files?${params.toString()}`);
        const data = (await res.json()) as {
          error?: string;
          files?: DriveFileRow[];
          nextPageToken?: string;
        };
        if (!res.ok) throw new Error(data.error || "Failed to load Drive");
        setDriveFiles((prev) => (opts.append ? [...prev, ...(data.files || [])] : data.files || []));
        setDriveNextPageToken(data.nextPageToken);
      } catch (e) {
        setDriveListError(e instanceof Error ? e.message : "Failed to load");
        if (!opts.append) setDriveFiles([]);
      } finally {
        setLoadingDrive(false);
      }
    },
    [driveSearch, currentParentId]
  );

  function enterFolder(id: string, name: string) {
    setPathStack((prev) => [...prev, { id, name }]);
    setDriveNextPageToken(undefined);
  }

  function navigateToDepth(endIndexExclusive: number) {
    setPathStack((prev) => prev.slice(0, endIndexExclusive));
    setDriveNextPageToken(undefined);
  }

  useEffect(() => {
    void loadDriveFiles({ append: false });
  }, [loadDriveFiles]);

  const triggerUpload = useCallback(() => {
    setUploadError(null);
    fileInputRef.current?.click();
  }, []);

  async function onUploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (!file) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("parent", currentParentId);
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { error?: string; file?: DriveFileRow };
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await loadDriveFiles({ append: false });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleCase("Drive")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase(
            "Browse My Drive, upload files into the current folder, and open files for preview or download — without opening the Drive website.",
          )}
        </p>
      </div>

      <div
        className="card flex flex-col overflow-hidden"
        style={{ minHeight: "calc(100vh - 220px)" }}
      >
        <nav
          className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-zinc-100 px-3 py-2.5 text-[13px] dark:border-zinc-800"
          aria-label="Drive folder path"
        >
          <button
            type="button"
            onClick={() => navigateToDepth(0)}
            className="rounded-md px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            {titleCase("My Drive")}
          </button>
          {pathStack.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <IconChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />
              <button
                type="button"
                onClick={() => navigateToDepth(index + 1)}
                className={`max-w-[200px] truncate rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  index === pathStack.length - 1
                    ? "font-semibold text-zinc-900 dark:text-zinc-100"
                    : "font-medium text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 p-1.5 dark:border-zinc-800">
          <div className="min-w-0 flex-1 px-2 py-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={driveSearchInput}
                onChange={(e) => setDriveSearchInput(e.target.value)}
                placeholder={titleCase("Search in this folder")}
                className="input-field w-full py-2 pl-9 pr-3 text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => void onUploadFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => triggerUpload()}
            disabled={uploadBusy}
            className="btn-secondary shrink-0 gap-2 px-3 py-2 text-[13px]"
            title={titleCase("Upload file to this folder")}
          >
            <Upload className="h-4 w-4 shrink-0" strokeWidth={2} />
            {uploadBusy ? titleCase("Uploading…") : titleCase("Upload")}
          </button>
          <button
            type="button"
            onClick={() => void loadDriveFiles({ append: false })}
            className="btn-ghost shrink-0 rounded-lg p-2"
            title={titleCase("Refresh")}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>

        {uploadError ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {uploadError}
          </div>
        ) : null}

        {loadingDrive ? (
          <div className="space-y-2 p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : driveListError ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{driveListError}</div>
        ) : driveFiles.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <IconFolder className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="text-center text-sm text-zinc-500">
              {titleCase(
                driveSearch ? "No items match your search" : "This folder is empty"
              )}
            </p>
          </div>
        ) : (
          <ul className="scrollbar-thin flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60">
            {driveFiles.map((file) => {
              const isFolder = file.mimeType === "application/vnd.google-apps.folder";
              const sizeNum = file.size ? parseInt(file.size, 10) : NaN;
              const sizeLabel = !Number.isNaN(sizeNum) ? formatBytes(sizeNum) : null;
              const metaLine = [
                isFolder ? titleCase("Folder") : null,
                file.modifiedTime ? formatDate(file.modifiedTime) : null,
                !isFolder && sizeLabel ? sizeLabel : null,
              ]
                .filter(Boolean)
                .join(" · ");

              if (isFolder) {
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => enterFolder(file.id, file.name)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100/80 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        <IconFolder className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                          {file.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{metaLine}</p>
                      </div>
                      <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    </button>
                  </li>
                );
              }

              return (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left text-zinc-800 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900/50"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200/60 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <IconFile className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                        {file.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{metaLine}</p>
                    </div>
                    <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {driveNextPageToken ? (
          <button
            type="button"
            className="border-t p-3 text-center text-xs font-medium text-emerald-600 hover:bg-zinc-50 dark:text-emerald-400 dark:hover:bg-zinc-900/50"
            onClick={() => void loadDriveFiles({ append: true, pageToken: driveNextPageToken })}
          >
            {titleCase("Load more")}
          </button>
        ) : null}
      </div>

      {previewFile ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewFile(null);
          }}
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-950"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-preview-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="min-w-0 flex-1">
                <h2 id="drive-preview-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {previewFile.name}
                </h2>
                <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{previewFile.mimeType}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="btn-ghost shrink-0 rounded-full p-2"
                aria-label={titleCase("Close")}
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 bg-zinc-100 dark:bg-zinc-900/50">
              {supportsInAppPreview(previewFile.mimeType) ? (
                <iframe
                  key={previewFile.id}
                  title={titleCase("File preview")}
                  src={`/api/drive/file/${encodeURIComponent(previewFile.id)}?mode=preview`}
                  className="h-full min-h-[50vh] w-full border-0"
                />
              ) : (
                <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-500">
                  <p>{titleCase("No in-app preview for this file type.")}</p>
                  <p className="text-xs">{titleCase("You can still download it below.")}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
              <a
                href={`/api/drive/file/${encodeURIComponent(previewFile.id)}?mode=download`}
                className="btn-primary gap-2"
              >
                <IconDownload className="h-4 w-4" />
                {titleCase("Download")}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
