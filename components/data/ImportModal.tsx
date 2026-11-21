"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";
import { csvRow, guessMapping, parseCsv } from "@/lib/data-model/csv";
import { dataApi } from "@/lib/data-model/client";

const MAX_ROWS = 100_000;
const MAX_BYTES = 25 * 1024 * 1024;
const BATCH = 100;

type Summary = { created: number; updated: number; duplicates: number; errors: number; linkedRecordsCreated: number };
type RowError = { row: number; error?: string };
type ImportResponse = { summary: Summary; errors: RowError[] };

const ZERO: Summary = { created: 0, updated: 0, duplicates: 0, errors: 0, linkedRecordsCreated: 0 };

const isListLike = (a: AttributeDef) => a.is_multi || a.type === "multi_select";

/**
 * CSV import into one object: pick a file, match its columns to fields, check the first 100 rows
 * (nothing is saved), then import in batches. Rows that fail are listed and can be downloaded.
 */
export function ImportModal({ objectSlug, objectName, attributes, onDone, onClose }: { objectSlug: string; objectName: string; attributes: AttributeDef[]; onDone: () => void; onClose: () => void }) {
  const attrs = useMemo(() => attributes.filter((a) => !a.archived_at), [attributes]);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  const [phase, setPhase] = useState<"pick" | "map" | "checked" | "running" | "done">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<Summary>(ZERO);
  const [failed, setFailed] = useState<RowError[]>([]);
  const cancelled = useRef(false);

  const headers = table?.[0] ?? [];
  const data = useMemo(() => table?.slice(1) ?? [], [table]);
  const nameCol = mapping.indexOf("name");

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("That file is over 25 MB. Split it and import the parts.");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setError("That file has no data rows. The first row should be the column names.");
    if (rows.length - 1 > MAX_ROWS) return setError(`That file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows. Split it and import the parts.`);
    setFileName(file.name);
    setTable(rows);
    setMapping(guessMapping(rows[0], attrs));
    setPhase("map");
  }

  function build(rows: string[][]) {
    return rows.map((cells) => {
      const values: Record<string, unknown> = {};
      let name = "";
      mapping.forEach((slug, col) => {
        const cell = (cells[col] ?? "").trim();
        if (!slug || !cell) return;
        if (slug === "name") {
          name = cell;
          return;
        }
        const attr = attrs.find((a) => a.slug === slug);
        values[slug] = attr && isListLike(attr) ? cell.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean) : cell;
      });
      return { name, values };
    });
  }

  async function runCheck() {
    setBusy(true);
    setError(null);
    const r = await dataApi<ImportResponse>("/api/data/import", { method: "POST", body: { object: objectSlug, rows: build(data.slice(0, BATCH)), dryRun: true, onDuplicate } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCheck(r.data);
    setPhase("checked");
  }

  async function runImport() {
    cancelled.current = false;
    setPhase("running");
    setProgress(0);
    setTotals(ZERO);
    setFailed([]);
    let acc = { ...ZERO };
    const errs: RowError[] = [];
    for (let start = 0; start < data.length; start += BATCH) {
      if (cancelled.current) break;
      const r = await dataApi<ImportResponse>("/api/data/import", {
        method: "POST",
        body: { object: objectSlug, rows: build(data.slice(start, start + BATCH)), dryRun: false, onDuplicate, startRow: start + 1 },
      });
      if (!r.ok) {
        // A whole batch refused (signed out, over a limit): record it against its rows and stop.
        errs.push({ row: start + 1, error: `Rows ${start + 1} to ${Math.min(start + BATCH, data.length)} weren't imported: ${r.error}` });
        break;
      }
      const s = r.data.summary;
      acc = { created: acc.created + s.created, updated: acc.updated + s.updated, duplicates: acc.duplicates + s.duplicates, errors: acc.errors + s.errors, linkedRecordsCreated: acc.linkedRecordsCreated + s.linkedRecordsCreated };
      errs.push(...r.data.errors);
      setTotals(acc);
      setProgress(Math.min(start + BATCH, data.length));
    }
    setFailed(errs);
    setPhase("done");
    onDone();
  }

  function downloadErrors() {
    const lines = [csvRow(["Row (first data row is 1)", "Problem"]), ...failed.map((f) => csvRow([f.row, f.error ?? ""]))];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-problems.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (typeof document === "undefined") return null;
  const used = new Set(mapping.filter(Boolean));

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && phase !== "running" && onClose()}>
      <div role="dialog" aria-label={`Import ${objectName}`} className="card flex max-h-[90vh] w-full max-w-[640px] flex-col shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">Import {objectName.toLowerCase()} from CSV</h2>
          <button type="button" aria-label="Close" disabled={phase === "running"} onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-[13px]">
          {phase === "pick" && (
            <div className="space-y-2">
              <p className="text-[var(--color-text-muted)]">One row per record, with the column names in the first row. Up to {MAX_ROWS.toLocaleString("en-IN")} rows.</p>
              <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => void pick(e.target.files?.[0])} className="block text-[13px]" />
            </div>
          )}

          {(phase === "map" || phase === "checked") && table && (
            <>
              <p className="text-[var(--color-text-muted)]">
                <span className="font-semibold text-[var(--color-text)]">{fileName}</span> · {data.length.toLocaleString("en-IN")} rows. Match each column to a field.
              </p>
              <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                {headers.map((h, col) => (
                  <li key={col} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate" title={h}>
                      {h || <em className="text-[var(--color-text-faint)]">(no heading)</em>}
                      <span className="ml-2 text-[12px] text-[var(--color-text-faint)]">{data[0]?.[col]?.slice(0, 24)}</span>
                    </span>
                    <select
                      aria-label={`Field for column ${h || col + 1}`}
                      value={mapping[col] ?? ""}
                      onChange={(e) => {
                        const next = [...mapping];
                        next[col] = e.target.value || null;
                        setMapping(next);
                        setCheck(null);
                        setPhase("map");
                      }}
                      className="input-field select-chevron h-8 w-[200px] text-[12.5px]"
                    >
                      <option value="">Don&apos;t import</option>
                      <option value="name" disabled={used.has("name") && mapping[col] !== "name"}>Name</option>
                      {attrs.map((a) => (
                        <option key={a.slug} value={a.slug} disabled={used.has(a.slug) && mapping[col] !== a.slug}>{a.name}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">When an email or domain already exists</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === "skip"} onChange={() => { setOnDuplicate("skip"); setCheck(null); setPhase("map"); }} /> Skip the row</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === "update"} onChange={() => { setOnDuplicate("update"); setCheck(null); setPhase("map"); }} /> Update that record (empty cells never clear anything; emails and phones are added)</label>
              </fieldset>
              {nameCol < 0 && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">Match one column to Name.</p>}
              <p className="text-[12px] text-[var(--color-text-faint)]">Cells in a link field (like Company) are matched by name; a name with no match creates that record. Team-member cells are matched by display name.</p>
            </>
          )}

          {phase === "checked" && check && (
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3" role="status">
              <p className="font-semibold">Check of the first {Math.min(BATCH, data.length)} rows (nothing saved)</p>
              <p>{check.summary.created} would be added · {check.summary.updated} updated · {check.summary.duplicates} skipped as duplicates · {check.summary.errors} with problems</p>
              {check.errors.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-[var(--color-danger)]">
                  {check.errors.slice(0, 8).map((e) => (
                    <li key={e.row}>Row {e.row}: {e.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="space-y-2" role="status" aria-live="polite">
              <p className="font-semibold">
                {phase === "running" ? "Importing…" : "Finished"} {progress.toLocaleString("en-IN")} of {data.length.toLocaleString("en-IN")} rows
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
                <div className="h-full bg-[var(--color-copper)] transition-[width]" style={{ width: `${data.length ? (progress / data.length) * 100 : 0}%` }} />
              </div>
              <p>{totals.created} added · {totals.updated} updated · {totals.duplicates} skipped as duplicates · {totals.errors} with problems{totals.linkedRecordsCreated ? ` · ${totals.linkedRecordsCreated} linked records created` : ""}</p>
              {phase === "done" && failed.length > 0 && (
                <div className="space-y-1">
                  <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-[var(--color-danger)]">
                    {failed.slice(0, 8).map((e) => (
                      <li key={`${e.row}-${e.error}`}>Row {e.row}: {e.error}</li>
                    ))}
                  </ul>
                  <button type="button" onClick={downloadErrors} className="font-semibold underline">Download all {failed.length} problems</button>
                </div>
              )}
            </div>
          )}

          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          {phase === "running" ? (
            <button type="button" onClick={() => (cancelled.current = true)} className="btn-ghost">Stop after this batch</button>
          ) : phase === "done" ? (
            <button type="button" onClick={onClose} className="btn-primary-copper">Close</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
              {(phase === "map" || phase === "checked") && (
                <button type="button" disabled={busy || nameCol < 0} onClick={() => void runCheck()} className="btn-ghost inline-flex items-center gap-2">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Check first rows
                </button>
              )}
              {phase === "checked" && (
                <button type="button" onClick={() => void runImport()} className="btn-primary-copper">Import {data.length.toLocaleString("en-IN")} rows</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
