"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import {
  IMPORT_TARGETS,
  IMPORT_TARGET_LABELS,
  MAX_IMPORT_ROWS,
  mapRows,
  mappingHasIdentity,
  normalizeImportRow,
  planImport,
  setColumnTarget,
  suggestMapping,
  type ColumnMapping,
  type ContactImportResult,
  type DuplicateMode,
  type ImportTarget,
  type ImportedContact,
  type RowProblem,
} from "@/lib/contact-import";
import type { DirectoryContact } from "@/lib/contact-directory";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
  headerless: boolean;
};

/** Stays under Vercel's 4.5 MB request cap — past it the import would fail with a bare 413. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** First couple of filled cells in a column, so the user can tell what it holds. */
function columnSample(rows: string[][], col: number): string {
  const out: string[] = [];
  for (const row of rows) {
    const v = (row[col] ?? "").trim();
    if (v) out.push(v.length > 40 ? `${v.slice(0, 40)}…` : v);
    if (out.length >= 2) break;
  }
  return out.join(" · ");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Bulk import into the team directory from a CSV / Excel file: upload, map
 * columns (auto-detected, editable) with a live preview of what will happen,
 * then a summary of what did. The preview judges rows with the same code as
 * the import API (lib/contact-import.ts), so its counts are what you get —
 * barring a teammate changing the directory in between.
 */
export function ContactImportModal({
  existing,
  onClose,
  onImported,
}: {
  /** The directory as currently loaded — only used to preview duplicates; the API re-checks against live data. */
  existing: DirectoryContact[];
  onClose: () => void;
  onImported: (result: ContactImportResult) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [mode, setMode] = useState<DuplicateMode>("skip");
  const [batchTag, setBatchTag] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContactImportResult | null>(null);

  async function readFile(file: File) {
    setParsing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/directory-contacts/import/parse", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as Partial<ParsedFile> & { error?: string };
      if (!res.ok || !data.headers || !data.rows || !data.rowNumbers) {
        throw new Error(data.error || "Couldn't read that file");
      }
      const next: ParsedFile = {
        fileName: data.fileName ?? file.name,
        headers: data.headers,
        rows: data.rows,
        rowNumbers: data.rowNumbers,
        headerless: !!data.headerless,
      };
      setParsed(next);
      setMapping(suggestMapping(next.headers, next.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    } finally {
      setParsing(false);
    }
  }

  const preview = useMemo(() => {
    if (!parsed) return null;
    const mapped = mapRows(parsed.headers, parsed.rows, parsed.rowNumbers, mapping);
    const valid: ImportedContact[] = [];
    const invalid: RowProblem[] = [];
    const warnings: RowProblem[] = [];
    for (const row of mapped) {
      const r = normalizeImportRow(row);
      if (r.ok) {
        valid.push(r.contact);
        for (const w of r.warnings) warnings.push({ line: r.contact.line, reason: w });
      } else {
        invalid.push({ line: r.line, reason: r.reason });
      }
    }
    const plan = planImport(valid, existing, mode, batchTag);
    return { mapped, valid, invalid, warnings, plan };
  }, [parsed, mapping, existing, mode, batchTag]);

  const hasIdentity = mappingHasIdentity(mapping);
  const actionable = preview ? preview.plan.creates.length + preview.plan.updates.length : 0;

  async function runImport() {
    if (!preview) return;
    setError(null);
    const payload = JSON.stringify({ rows: preview.mapped, mode, batchTag: batchTag.trim() });
    if (new Blob([payload]).size > MAX_PAYLOAD_BYTES) {
      setError("This file holds too much data to send in one go. Split it into smaller files.");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/directory-contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ContactImportResult> & { error?: string };
      if (!res.ok || typeof data.created !== "number") throw new Error(data.error || "Import failed");
      const done = data as ContactImportResult;
      setResult(done);
      onImported(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function resetFile() {
    setParsed(null);
    setMapping([]);
    setError(null);
  }

  const busy = parsing || importing;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-import-title"
        data-testid="contact-import-modal"
      >
        <div className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
          <h2 id="contact-import-title" className="font-display text-lg font-bold text-[var(--color-text)]">
            {titleCase("Import contacts")}
          </h2>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {result ? (
            <ImportSummary result={result} />
          ) : !parsed ? (
            <>
              <input
                ref={fileRef}
                data-testid="contact-import-file-input"
                type="file"
                accept=".csv,.tsv,.xlsx,.xls,.ods"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void readFile(file);
                }}
              />
              <button
                type="button"
                disabled={parsing}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void readFile(file);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors disabled:opacity-60 [&>*]:pointer-events-none",
                  dragOver
                    ? "border-[var(--color-copper)] bg-[var(--color-surface-offset)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-offset)]/60"
                )}
              >
                <Upload className="h-6 w-6 text-[var(--color-text-faint)]" />
                <span className="text-[14px] font-semibold text-[var(--color-text)]">
                  {parsing ? "Reading file…" : titleCase("Choose a file or drop it here")}
                </span>
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  .csv, .xlsx or .xls · up to {MAX_IMPORT_ROWS.toLocaleString()} rows
                </span>
              </button>
            </>
          ) : (
            preview && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-offset)] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileSpreadsheet className="h-5 w-5 shrink-0 text-[var(--color-success)]" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">{parsed.fileName}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)]">
                        {plural(parsed.rows.length, "row")} · {plural(parsed.headers.length, "column")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="shrink-0 text-[12px] font-semibold text-[var(--color-copper)] hover:underline disabled:opacity-60"
                    onClick={resetFile}
                  >
                    {titleCase("Choose another file")}
                  </button>
                </div>

                <section>
                  <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                          <th className="px-3 py-2">{titleCase("In your file")}</th>
                          <th className="hidden px-3 py-2 sm:table-cell">{titleCase("Sample")}</th>
                          <th className="px-3 py-2">{titleCase("Import as")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {parsed.headers.map((header, col) => (
                          <tr key={col}>
                            <td className="max-w-[180px] truncate px-3 py-2 font-medium text-[var(--color-text)]">
                              {header}
                            </td>
                            <td className="hidden max-w-[260px] truncate px-3 py-2 text-[var(--color-text-muted)] sm:table-cell">
                              {columnSample(parsed.rows, col) || <span className="text-[var(--color-text-faint)]">Empty</span>}
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                data-testid={`contact-import-map-${col}`}
                                value={mapping[col] ?? ""}
                                disabled={importing}
                                onChange={(e) =>
                                  setMapping((m) =>
                                    setColumnTarget(m, col, (e.target.value || null) as ImportTarget | null)
                                  )
                                }
                                className={cn(
                                  "input-field h-8 w-full text-[12.5px]",
                                  !mapping[col] && "text-[var(--color-text-faint)]"
                                )}
                              >
                                <option value="">{titleCase("Don't import")}</option>
                                {IMPORT_TARGETS.map((t) => (
                                  <option key={t} value={t}>
                                    {IMPORT_TARGET_LABELS[t]}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!hasIdentity && (
                    <p className="mt-2 text-[12.5px] text-[var(--color-danger)]">
                      Map a name, email or phone column.
                    </p>
                  )}
                </section>

                {hasIdentity && (
                  <>
                    <section>
                      <p className="text-[13px] text-[var(--color-text)]">
                        <strong>{plural(preview.plan.creates.length, "new contact")}</strong>
                        {mode === "update" && preview.plan.updates.length > 0 && (
                          <>, {plural(preview.plan.updates.length, "update")}</>
                        )}
                        {mode === "skip" && preview.plan.skippedExisting > 0 && (
                          <span className="text-[var(--color-text-muted)]">
                            , {preview.plan.skippedExisting.toLocaleString()} already saved (skipped)
                          </span>
                        )}
                        {preview.plan.mergedInFile > 0 && (
                          <span className="text-[var(--color-text-muted)]">
                            , {preview.plan.mergedInFile.toLocaleString()} duplicate in file
                          </span>
                        )}
                      </p>
                      <ProblemList
                        tone="danger"
                        title={`${plural(preview.invalid.length, "row")} can't be imported`}
                        items={preview.invalid}
                      />
                      <ProblemList
                        tone="warning"
                        title={`${plural(preview.warnings.length, "value")} will be left blank or adjusted`}
                        items={preview.warnings}
                      />

                    </section>

                    <section className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-[var(--color-text)]">
                      <span className="text-[var(--color-text-muted)]">{titleCase("If already saved:")}</span>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="contact-import-mode"
                          checked={mode === "skip"}
                          disabled={importing}
                          onChange={() => setMode("skip")}
                        />
                        Skip
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="contact-import-mode"
                          data-testid="contact-import-mode-update"
                          checked={mode === "update"}
                          disabled={importing}
                          onChange={() => setMode("update")}
                        />
                        Update
                      </label>
                    </section>

                    <input
                      data-testid="contact-import-batch-tag"
                      value={batchTag}
                      disabled={importing}
                      onChange={(e) => setBatchTag(e.target.value)}
                      maxLength={100}
                      placeholder="Tag this import (optional)"
                      className="input-field w-full text-[13px] sm:max-w-xs"
                    />
                  </>
                )}
              </>
            )
          )}

          {error && (
            <p
              data-testid="contact-import-error"
              className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          {result ? (
            <button type="button" className="btn-primary-copper px-4" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn-ghost px-4" onClick={onClose} disabled={importing}>
                Cancel
              </button>
              {parsed && (
                <button
                  type="button"
                  data-testid="contact-import-submit"
                  className="btn-primary-copper px-4"
                  disabled={importing || !hasIdentity || actionable === 0}
                  onClick={() => void runImport()}
                >
                  {importing
                    ? "Importing…"
                    : actionable === 0
                      ? titleCase("Nothing to import")
                      : titleCase(`Import ${plural(actionable, "contact")}`)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Rows shown in a problem list before it's cut off. */
const PROBLEM_LIST_LIMIT = 50;

function ProblemList({
  tone,
  title,
  items,
}: {
  tone: "danger" | "warning";
  title: string;
  items: RowProblem[];
}) {
  if (items.length === 0) return null;
  return (
    <details className="mt-2 text-[12.5px]">
      <summary
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 font-semibold",
          tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </summary>
      <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-[var(--color-surface-offset)] px-3 py-2 text-[var(--color-text-muted)]">
        {items.slice(0, PROBLEM_LIST_LIMIT).map((p, i) => (
          <li key={`${p.line}-${i}`}>
            <span className="font-medium text-[var(--color-text)]">Row {p.line}:</span> {p.reason}
          </li>
        ))}
        {items.length > PROBLEM_LIST_LIMIT && (
          <li className="text-[var(--color-text-faint)]">
            and {(items.length - PROBLEM_LIST_LIMIT).toLocaleString()} more
          </li>
        )}
      </ul>
    </details>
  );
}

function ImportSummary({ result }: { result: ContactImportResult }) {
  const lines: { text: string; muted?: boolean }[] = [
    { text: `${plural(result.created, "contact")} added` },
  ];
  if (result.updated > 0) lines.push({ text: `${plural(result.updated, "existing contact")} updated` });
  if (result.skippedExisting > 0) {
    lines.push({ text: `${plural(result.skippedExisting, "contact was", "contacts were")} already in the directory and skipped`, muted: true });
  }
  if (result.unchanged > 0) {
    lines.push({ text: `${plural(result.unchanged, "existing contact was", "existing contacts were")} already up to date`, muted: true });
  }
  if (result.mergedInFile > 0) {
    lines.push({ text: `${plural(result.mergedInFile, "duplicate row")} in the file merged`, muted: true });
  }

  return (
    <div className="space-y-3" data-testid="contact-import-summary">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-success)]" />
        <ul className="space-y-1 text-[13px]">
          {lines.map((l) => (
            <li key={l.text} className={l.muted ? "text-[var(--color-text-muted)]" : "font-semibold text-[var(--color-text)]"}>
              {l.text}
            </li>
          ))}
        </ul>
      </div>
      <ProblemList
        tone="danger"
        title={`${plural(result.failed.length, "row")} couldn't be saved`}
        items={result.failed}
      />
      <ProblemList
        tone="danger"
        title={`${plural(result.invalid.length, "row")} skipped (no name, email or phone)`}
        items={result.invalid}
      />
    </div>
  );
}
