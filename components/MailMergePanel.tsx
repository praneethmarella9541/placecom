"use client";

import { useMemo, useRef, useState } from "react";
import { titleCase } from "@/lib/title-case";
import { mergeTemplate, listPlaceholdersInTemplate, type MailMergeRow } from "@/lib/mail-merge";
import { IconMail, IconPaperclip, IconSend, IconX } from "@/components/Icons";

type PendingFile = { file: File; base64: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MailMergePanel() {
  const [rows, setRows] = useState<MailMergeRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [headerLabels, setHeaderLabels] = useState<string[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [subjectTemplate, setSubjectTemplate] = useState(
    "Placement update for {{name}}"
  );
  const [bodyTemplate, setBodyTemplate] = useState(
    "Dear {{name}},\n\nWe are reaching out from the placement office.\n\nBest regards,\nPlacement Team"
  );
  const [previewIndex, setPreviewIndex] = useState(0);

  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const attachRef = useRef<HTMLInputElement>(null);

  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { email: string; error: string }[];
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const previewRow = rows[previewIndex] ?? rows[0];
  const previewSubject = useMemo(
    () => (previewRow ? mergeTemplate(subjectTemplate, previewRow.fields) : ""),
    [previewRow, subjectTemplate]
  );
  const previewBody = useMemo(
    () => (previewRow ? mergeTemplate(bodyTemplate, previewRow.fields) : ""),
    [previewRow, bodyTemplate]
  );

  const placeholderHints = useMemo(() => {
    const keys = new Set([
      ...listPlaceholdersInTemplate(subjectTemplate),
      ...listPlaceholdersInTemplate(bodyTemplate),
    ]);
    if (columns.length) {
      for (const c of columns) keys.add(c);
    }
    return Array.from(keys).filter((k) => k !== "email");
  }, [subjectTemplate, bodyTemplate, columns]);

  const onPickFile = async (list: FileList | null) => {
    if (!list?.length) return;
    const file = list[0];
    setParseError(null);
    setImportInfo(null);
    setParseBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/broadcast/parse-mail-merge", { method: "POST", body: fd });
      const data = (await res.json()) as {
        error?: string;
        headersFound?: string;
        detectedHeaders?: string[];
        headerLabels?: string[];
        rows?: MailMergeRow[];
        columns?: string[];
        skipped?: number;
        truncated?: boolean;
        maxRows?: number;
      };
      if (!res.ok) {
        const extra =
          data.headersFound || data.detectedHeaders?.length
            ? ` Headers found: ${data.headersFound || data.detectedHeaders?.join(", ")}.`
            : "";
        throw new Error((data.error || "Import failed") + extra);
      }
      const imported = data.rows || [];
      setRows(imported);
      setColumns(data.columns || []);
      setHeaderLabels(data.headerLabels || data.detectedHeaders || []);
      setPreviewIndex(0);
      const parts = [
        `Loaded ${imported.length} recipient(s).`,
        data.skipped ? `${data.skipped} row(s) skipped (missing/invalid email).` : "",
        data.truncated ? `Only first ${data.maxRows} rows kept (batch limit).` : "",
      ].filter(Boolean);
      setImportInfo(parts.join(" "));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setParseBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onAttach = async (list: FileList | null) => {
    if (!list) return;
    const next: PendingFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (file.size > 24 * 1024 * 1024) {
        alert(`${file.name} is too large (max 24 MB per file)`);
        continue;
      }
      const base64 = await fileToBase64(file);
      next.push({ file, base64 });
    }
    if (next.length) setAttachments((p) => [...p, ...next]);
    if (attachRef.current) attachRef.current.value = "";
  };

  const sendMailMerge = async () => {
    setSendError(null);
    setSendResult(null);
    if (rows.length === 0) {
      setSendError("Import a spreadsheet with at least one valid email row.");
      return;
    }
    setSendBusy(true);
    try {
      const att = attachments.map((a) => ({
        filename: a.file.name,
        mimeType: a.file.type || "application/octet-stream",
        base64Data: a.base64,
      }));
      const res = await fetch("/api/broadcast/mail-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectTemplate: subjectTemplate.trim(),
          bodyTemplate,
          rows,
          attachments: att.length ? att : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        sent?: number;
        failed?: { email: string; error: string }[];
      };
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSendResult({
        sent: data.sent ?? 0,
        failed: data.failed ?? [],
      });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="card space-y-6 p-5 sm:p-6">
      <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/25 dark:text-sky-100">
        <IconMail className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" />
        <p>
          {titleCase(
            "Mail merge sends a personalized email to each row. Use placeholders like {{name}} or {{phone}} in subject and body. Import CSV/Excel with column headers (Email required)."
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {titleCase("Recipients")}
          </h2>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Import CSV or Excel")}
            </label>
            <p className="mb-2 text-xs text-zinc-400">
              {titleCase(
                "Row 1 = column headers (Name, Phone, etc.). One column must be Email or contain email addresses in each row."
              )}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.ods"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files)}
            />
            <button
              type="button"
              disabled={parseBusy}
              onClick={() => fileRef.current?.click()}
              className="btn-secondary w-full justify-center sm:w-auto"
            >
              {parseBusy ? titleCase("Reading…") : titleCase("Choose file")}
            </button>
            {parseError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p>
            ) : null}
            {importInfo ? (
              <p className="mt-2 text-xs text-[var(--color-copper)]">{importInfo}</p>
            ) : null}
          </div>

          {headerLabels.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">
                {titleCase("Columns detected — use these in {{braces}}")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {headerLabels.map((label, i) => {
                  const key = columns[i] || label.toLowerCase();
                  if (key === "email") return null;
                  return (
                    <code
                      key={`${label}-${i}`}
                      className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      title={label}
                    >
                      {`{{${key}}}`}
                    </code>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">
              {titleCase("List")} ({rows.length})
            </p>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
                {titleCase("No recipients yet")}
              </p>
            ) : (
              <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                {rows.map((row, i) => (
                  <li
                    key={`${row.email}-${i}`}
                    className="rounded-md bg-white px-2 py-1.5 text-xs dark:bg-zinc-950"
                  >
                    <span className="font-mono text-zinc-800 dark:text-zinc-200">{row.email}</span>
                    {Object.entries(row.fields)
                      .filter(([k, v]) => k !== "email" && v.trim())
                      .slice(0, 3)
                      .map(([k, v]) => (
                        <span key={k} className="ml-2 text-zinc-500">
                          · {v}
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {titleCase("Templates")}
          </h2>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Subject")}
            </label>
            <input
              type="text"
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              className="input-field font-mono text-sm"
              placeholder="Hello {{name}}"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Body")}
            </label>
            <textarea
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              rows={10}
              className="input-field resize-y font-mono text-sm"
              placeholder={"Dear {{name}},\n\nYour number: {{phone}}"}
            />
          </div>
          <div>
            <input
              ref={attachRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void onAttach(e.target.files)}
            />
            <button
              type="button"
              onClick={() => attachRef.current?.click()}
              className="btn-ghost gap-1.5 text-sm"
            >
              <IconPaperclip className="h-4 w-4" />
              {titleCase("Add attachments (same file for all)")}
            </button>
            {attachments.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {attachments.map((a, i) => (
                  <li
                    key={`${a.file.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs dark:bg-zinc-800"
                  >
                    <span className="truncate">
                      {a.file.name}{" "}
                      <span className="text-zinc-400">({formatBytes(a.file.size)})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                      className="text-zinc-400 hover:text-red-500"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {titleCase("Preview")}
            </h3>
            {rows.length > 1 ? (
              <select
                value={previewIndex}
                onChange={(e) => setPreviewIndex(Number(e.target.value))}
                className="input-field w-auto py-1.5 text-xs"
              >
                {rows.map((row, i) => (
                  <option key={`${row.email}-${i}`} value={i}>
                    {row.fields.name || row.email}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">
            {titleCase("To:")}{" "}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">{previewRow?.email}</span>
          </p>
          <p className="mt-2 text-xs font-medium text-zinc-500">{titleCase("Subject")}</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">{previewSubject || "—"}</p>
          <p className="mt-3 text-xs font-medium text-zinc-500">{titleCase("Body")}</p>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {previewBody || "—"}
          </pre>
          {placeholderHints.length > 0 ? (
            <p className="mt-2 text-[11px] text-zinc-400">
              {titleCase("Detected fields:")} {placeholderHints.map((h) => `{{${h}}}`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {sendError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {sendError}
        </div>
      ) : null}
      {sendResult ? (
        <div className="rounded-lg border border-[var(--color-copper)]/30 bg-[var(--color-copper)]/10 px-4 py-3 text-sm text-[var(--color-copper-hover)]">
          <p className="font-medium">
            {titleCase(`Sent: ${sendResult.sent}`)}
            {sendResult.failed.length > 0
              ? ` · ${titleCase(`Failed: ${sendResult.failed.length}`)}`
              : ""}
          </p>
          {sendResult.failed.length > 0 ? (
            <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs">
              {sendResult.failed.map((f) => (
                <li key={f.email}>
                  <span className="font-mono">{f.email}</span>: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          disabled={sendBusy || rows.length === 0}
          onClick={() => void sendMailMerge()}
          className="btn-primary-copper min-w-[160px] justify-center"
        >
          {sendBusy ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {titleCase("Sending…")}
            </>
          ) : (
            <>
              <IconSend className="h-4 w-4" />
              {titleCase(`Send ${rows.length} personalized email(s)`)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
