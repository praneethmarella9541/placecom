"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as XLSX from "xlsx";
import { ArrowLeft, Loader2, Save, AlertTriangle } from "lucide-react";
import type { CellBase, Matrix } from "react-spreadsheet";
import { titleCase } from "@/lib/title-case";
import { isEditableSpreadsheetMimeType } from "@/lib/drive-file-proxy";

const Spreadsheet = dynamic(() => import("react-spreadsheet"), { ssr: false });

type FileMeta = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

type LoadState = "loading" | "ready" | "error" | "unsupported" | "too-large";

const MAX_EDITABLE_BYTES = 5 * 1024 * 1024;

function sheetToMatrix(ws: XLSX.WorkSheet): { matrix: Matrix<CellBase>; startRow: number; startCol: number } {
  const ref = ws["!ref"];
  if (!ref) return { matrix: [[]], startRow: 0, startCol: 0 };
  const range = XLSX.utils.decode_range(ref);
  const matrix: Matrix<CellBase> = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (CellBase | undefined)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef] as XLSX.CellObject | undefined;
      const isFormula = !!cell?.f;
      row.push({
        value: cell?.v ?? "",
        readOnly: isFormula,
        className: isFormula ? "sheet-editor-formula-cell" : undefined,
      });
    }
    matrix.push(row);
  }
  return { matrix, startRow: range.s.r, startCol: range.s.c };
}

export default function DriveSheetEditorPage({ params }: { params: { id: string } }) {
  const fileId = params.id;

  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [gridData, setGridData] = useState<Matrix<CellBase>>([[]]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const rangeOffsetRef = useRef<{ startRow: number; startCol: number }>({ startRow: 0, startCol: 0 });
  /** Mirrors the last matrix we handed to <Spreadsheet>, so onChange can diff
   * against it to find exactly which cells changed — react-spreadsheet's own
   * onCellCommit reports stale coordinates on paste (see handleGridChange). */
  const lastGridDataRef = useRef<Matrix<CellBase>>([[]]);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    setSaveError(null);
    setConflict(false);
    try {
      const detailsRes = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}?details=1`);
      const detailsJson = await detailsRes.json();
      if (!detailsRes.ok) throw new Error(detailsJson.error || "Could not load file details");
      const file = detailsJson.file as FileMeta;
      setMeta(file);

      if (!isEditableSpreadsheetMimeType(file.mimeType)) {
        setState("unsupported");
        return;
      }

      const bytesRes = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}?mode=download`);
      if (!bytesRes.ok) {
        const j = await bytesRes.json().catch(() => ({}));
        throw new Error(j.error || "Could not load file content");
      }
      const buf = await bytesRes.arrayBuffer();
      if (buf.byteLength > MAX_EDITABLE_BYTES) {
        setState("too-large");
        return;
      }

      const wb = XLSX.read(buf, { type: "array", cellStyles: true, cellFormula: true });
      workbookRef.current = wb;
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0] ?? "";
      setActiveSheet(firstSheet);
      if (firstSheet) {
        const { matrix, startRow, startCol } = sheetToMatrix(wb.Sheets[firstSheet]);
        rangeOffsetRef.current = { startRow, startCol };
        lastGridDataRef.current = matrix;
        setGridData(matrix);
      }
      setDirty(false);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spreadsheet");
      setState("error");
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const switchSheet = useCallback((name: string) => {
    const wb = workbookRef.current;
    if (!wb || !wb.Sheets[name]) return;
    setActiveSheet(name);
    const { matrix, startRow, startCol } = sheetToMatrix(wb.Sheets[name]);
    rangeOffsetRef.current = { startRow, startCol };
    lastGridDataRef.current = matrix;
    setGridData(matrix);
  }, []);

  /**
   * react-spreadsheet's onCellCommit reports `state.lastChanged` as the edit
   * coordinates, but that field is only updated on a typed single-cell
   * commit — it's stale (or null) on paste/cut/delete, which silently wrote
   * pasted values to the wrong cell. onChange always carries the full,
   * correct matrix regardless of how the edit happened, so we diff against
   * the previous matrix here instead of trusting per-cell commit coords.
   */
  const handleGridChange = useCallback(
    (next: Matrix<CellBase>) => {
      const wb = workbookRef.current;
      const prev = lastGridDataRef.current;
      if (wb && activeSheet) {
        const ws = wb.Sheets[activeSheet];
        const { startRow, startCol } = rangeOffsetRef.current;
        let changed = false;
        for (let row = 0; row < next.length; row++) {
          const nextRow = next[row] ?? [];
          const prevRow = prev[row] ?? [];
          for (let col = 0; col < nextRow.length; col++) {
            const nextValue = nextRow[col]?.value;
            const prevValue = prevRow[col]?.value;
            if (nextValue === prevValue) continue;
            changed = true;
            const cellRef = XLSX.utils.encode_cell({ r: startRow + row, c: startCol + col });
            if (nextValue === undefined || nextValue === null || nextValue === "") {
              delete ws[cellRef];
            } else if (typeof nextValue === "number") {
              ws[cellRef] = { t: "n", v: nextValue };
            } else {
              ws[cellRef] = { t: "s", v: String(nextValue) };
            }
          }
        }
        if (changed) setDirty(true);
      }
      lastGridDataRef.current = next;
      setGridData(next);
    },
    [activeSheet]
  );

  const handleSave = useCallback(
    async (force = false) => {
      const wb = workbookRef.current;
      if (!wb || !meta) return;
      setSaving(true);
      setSaveError(null);
      setConflict(false);
      try {
        const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const headers: Record<string, string> = {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
        if (!force) headers["X-Expected-Modified-Time"] = meta.modifiedTime;

        const res = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}/content`, {
          method: "PUT",
          headers,
          body: out,
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setConflict(true);
          return;
        }
        if (!res.ok) throw new Error(json.error || json.message || "Save failed");

        setMeta((prev) => (prev ? { ...prev, modifiedTime: json.file?.modifiedTime ?? prev.modifiedTime } : prev));
        setDirty(false);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [fileId, meta]
  );

  const formulaCaveatNote = useMemo(
    () =>
      titleCase(
        "Formula cells are shown for reference and can't be edited here — download the file to edit formulas."
      ),
    []
  );

  return (
    <div className="flex h-[calc(100vh-var(--topbar-height,0px))] min-h-0 flex-col bg-[var(--color-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/drive"
            className="btn-ghost shrink-0 gap-2 rounded-full p-2"
            aria-label={titleCase("Back to Drive")}
            onClick={(e) => {
              if (dirty && !window.confirm(titleCase("You have unsaved changes. Leave without saving?"))) {
                e.preventDefault();
              }
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-[var(--color-text)]">
              {meta?.name ?? titleCase("Loading…")}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-faint)]">{formulaCaveatNote}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSave(false)}
          disabled={!dirty || saving || state !== "ready"}
          className="btn-primary shrink-0 gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? titleCase("Saving…") : dirty ? titleCase("Save") : titleCase("Saved")}
        </button>
      </div>

      {saveError ? (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-red-50 px-4 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      ) : null}

      {conflict ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{titleCase("This file changed since you opened it.")}</span>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            {titleCase("Reload latest")}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void handleSave(true)}>
            {titleCase("Save anyway")}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state === "loading" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-text-muted)]">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-copper)]" />
            <p className="text-sm font-medium">{titleCase("Opening spreadsheet…")}</p>
          </div>
        ) : state === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--color-text-muted)]">
            <p>{error}</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => void load()}>
              {titleCase("Try again")}
            </button>
          </div>
        ) : state === "unsupported" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--color-text-muted)]">
            <p>{titleCase("This file type can't be edited in-app.")}</p>
            <Link href="/drive" className="btn-secondary mt-2">
              {titleCase("Back to Drive")}
            </Link>
          </div>
        ) : state === "too-large" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--color-text-muted)]">
            <p>{titleCase("This file is too large to edit in-app (max 5MB).")}</p>
            <p className="text-xs text-[var(--color-text-faint)]">
              {titleCase("Download it from Drive and edit it locally instead.")}
            </p>
          </div>
        ) : (
          <>
            {sheetNames.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
                {sheetNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => switchSheet(name)}
                    className={
                      name === activeSheet
                        ? "border-b-2 border-[var(--color-copper)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)]"
                        : "px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="inline-block min-w-full">
              <Spreadsheet data={gridData} onChange={handleGridChange} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
