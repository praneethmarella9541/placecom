"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { ArrowLeft, Loader2, Save, AlertTriangle, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import type { CellBase, Matrix, Point, Mode, SpreadsheetRef } from "react-spreadsheet";
import { titleCase } from "@/lib/title-case";
import { isEditableSpreadsheetMimeType } from "@/lib/drive-file-proxy";
import { SheetEditorGridContext } from "./SheetEditorGridContext";
import SheetDataEditor from "./SheetDataEditor";
import SheetDataViewer from "./SheetDataViewer";
import { getDataCellElement, rectFromElement, type Rect } from "./sheetEditorDom";

const Spreadsheet = dynamic(() => import("react-spreadsheet"), { ssr: false });

type FileMeta = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

type LoadState = "loading" | "ready" | "error" | "unsupported" | "too-large";

const MAX_EDITABLE_BYTES = 5 * 1024 * 1024;

/** Grid always shows at least this many columns/rows beyond the sheet's own
 * used range, so there's room to type into new columns/rows like Excel —
 * without this, the grid stopped exactly at the last column/row that already
 * had data (e.g. only A:D visible if that's all that was ever filled in). */
const MIN_GRID_COLUMNS = 26;
const MIN_GRID_ROWS = 100;

/** react-spreadsheet has no virtualization — every cell becomes a real DOM
 * node + React component. A real-world sheet with thousands of rows can hang
 * or crash the tab if rendered in full, so both the padding above and the
 * sheet's own size are capped against this budget before anything renders. */
const MAX_RENDERED_CELLS = 8000;

function getSheetRange(ws: XLSX.WorkSheet): XLSX.Range {
  const ref = ws["!ref"];
  return ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
}

/** Sheet's own used-range size, ignoring the extra padding we add for typing
 * room — used to decide up front whether a sheet is safe to render at all. */
function sheetCellCount(ws: XLSX.WorkSheet): number {
  const range = getSheetRange(ws);
  const rows = Math.max(range.e.r - range.s.r + 1, 0);
  const cols = Math.max(range.e.c - range.s.c + 1, 0);
  return rows * cols;
}

/** Grows the worksheet's `!ref` (its used-range bounds) to include {r, c} if
 * it doesn't already. Without this, writing into a cell beyond the sheet's
 * original bounds (e.g. a new column E on a sheet that only had A:D) would
 * get silently dropped on save — `!ref` is what XLSX.write treats as the
 * sheet's real extent. */
function ensureSheetRangeIncludes(ws: XLSX.WorkSheet, r: number, c: number): void {
  const existingRef = ws["!ref"];
  const existing = existingRef ? XLSX.utils.decode_range(existingRef) : { s: { r, c }, e: { r, c } };
  const next = {
    s: { r: Math.min(existing.s.r, r), c: Math.min(existing.s.c, c) },
    e: { r: Math.max(existing.e.r, r), c: Math.max(existing.e.c, c) },
  };
  ws["!ref"] = XLSX.utils.encode_range(next);
}

/** Writes a single cell's value into the raw worksheet, matching SheetJS's
 * cell-object shape. Shared by normal typed/pasted edits and the fill handle
 * so both paths behave identically. */
function applyCellEdit(ws: XLSX.WorkSheet, cellRef: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    delete ws[cellRef];
    return;
  }
  if (typeof value === "string" && value.startsWith("=") && value.length > 1) {
    // No cached `v` — Excel/Sheets/SheetJS all recalculate formulas on open.
    ws[cellRef] = { f: value.slice(1) };
  } else if (typeof value === "number") {
    ws[cellRef] = { t: "n", v: value };
  } else {
    ws[cellRef] = { t: "s", v: String(value) };
  }
  const { r, c } = XLSX.utils.decode_cell(cellRef);
  ensureSheetRangeIncludes(ws, r, c);
}

function sheetToMatrix(ws: XLSX.WorkSheet): { matrix: Matrix<CellBase>; startRow: number; startCol: number } {
  const range = getSheetRange(ws);
  const existingRows = Math.max(range.e.r - range.s.r + 1, 0);
  const existingCols = Math.max(range.e.c - range.s.c + 1, 0);

  // Pad up to the minimum so there's room to type into new rows/columns, but
  // never past the render budget, and never shrink the sheet's own data —
  // callers must already have checked sheetCellCount() before calling this.
  let rows = Math.max(existingRows, MIN_GRID_ROWS);
  let cols = Math.max(existingCols, MIN_GRID_COLUMNS);
  if (rows * cols > MAX_RENDERED_CELLS) {
    rows = Math.max(existingRows, Math.floor(MAX_RENDERED_CELLS / Math.max(cols, 1)));
    if (rows * cols > MAX_RENDERED_CELLS) {
      cols = Math.max(existingCols, Math.floor(MAX_RENDERED_CELLS / Math.max(rows, 1)));
    }
  }

  const endRow = range.s.r + rows - 1;
  const endCol = range.s.c + cols - 1;
  const matrix: Matrix<CellBase> = [];
  for (let r = range.s.r; r <= endRow; r++) {
    const row: (CellBase | undefined)[] = [];
    for (let c = range.s.c; c <= endCol; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef] as XLSX.CellObject | undefined;
      const isFormula = !!cell?.f;
      row.push({
        value: isFormula ? `=${cell.f}` : cell?.v ?? "",
        className: isFormula ? "sheet-editor-formula-cell" : undefined,
      });
    }
    matrix.push(row);
  }
  return { matrix, startRow: range.s.r, startCol: range.s.c };
}

/** Increments non-absolute row references in a formula by `delta` rows, for
 * drag-fill. Negative lookbehind avoids false-matching inside function names
 * like LOG10. Known limitation: can't distinguish a true cell ref from
 * scientific notation (e.g. "1E5") — acceptable for "basic" fill support. */
const CELL_REF_RE = /(?<![A-Za-z0-9_])(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
function shiftFormulaRows(formula: string, delta: number): string {
  return formula.replace(CELL_REF_RE, (_m, colAbs: string, col: string, rowAbs: string, rowNum: string) => {
    if (rowAbs === "$") return `${colAbs}${col}${rowAbs}${rowNum}`;
    return `${colAbs}${col}${rowAbs}${parseInt(rowNum, 10) + delta}`;
  });
}

function rowIndexAtY(container: HTMLElement | null, y: number): number {
  const tbody = container?.querySelector("table tbody");
  if (!tbody) return -1;
  let result = -1;
  for (let i = 1; i < tbody.children.length; i++) {
    const rect = (tbody.children[i] as HTMLElement).getBoundingClientRect();
    if (y >= rect.top) result = i - 1;
    else break;
  }
  return result;
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
  const [sheetSwitchWarning, setSheetSwitchWarning] = useState<string | null>(null);

  const [activeCell, setActiveCell] = useState<Point | null>(null);
  const [gridMode, setGridMode] = useState<Mode>("view");

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);

  const [fillHandleRect, setFillHandleRect] = useState<Rect | null>(null);
  const [fillPreview, setFillPreview] = useState<{ startRow: number; col: number; toRow: number } | null>(null);

  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const rangeOffsetRef = useRef<{ startRow: number; startCol: number }>({ startRow: 0, startCol: 0 });
  const activeSheetRef = useRef(activeSheet);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const spreadsheetRef = useRef<SpreadsheetRef>(null);
  const fillDragRef = useRef<{ startRow: number; col: number; toRow: number } | null>(null);
  /** Mirrors the last matrix we handed to <Spreadsheet>, so onChange can diff
   * against it to find exactly which cells changed — react-spreadsheet's own
   * onCellCommit reports stale coordinates on paste (see handleGridChange). */
  const lastGridDataRef = useRef<Matrix<CellBase>>([[]]);

  useEffect(() => {
    activeSheetRef.current = activeSheet;
  }, [activeSheet]);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    setSaveError(null);
    setConflict(false);
    setSheetSwitchWarning(null);
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
        const ws = wb.Sheets[firstSheet];
        // react-spreadsheet renders every cell as a real DOM node — check
        // size BEFORE building/rendering a potentially huge matrix, rather
        // than finding out by hanging the tab.
        if (sheetCellCount(ws) > MAX_RENDERED_CELLS) {
          setState("too-large");
          return;
        }
        const { matrix, startRow, startCol } = sheetToMatrix(ws);
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
    const ws = wb.Sheets[name];
    if (sheetCellCount(ws) > MAX_RENDERED_CELLS) {
      setSheetSwitchWarning(
        titleCase(`"${name}" has too many rows/columns to open in-app. Download the file to view it instead.`)
      );
      return;
    }
    setSheetSwitchWarning(null);
    setActiveSheet(name);
    const { matrix, startRow, startCol } = sheetToMatrix(ws);
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
            applyCellEdit(ws, cellRef, nextValue);
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
        "Basic formulas are supported (SUM, AVERAGE, IF, VLOOKUP, and more) — not every Excel function, and formulas can only reference cells on the same sheet."
      ),
    []
  );

  // ── Search ──────────────────────────────────────────────────────────────
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as { row: number; col: number }[];
    const out: { row: number; col: number }[] = [];
    gridData.forEach((r, ri) =>
      r.forEach((c, ci) => {
        const v = c?.value;
        if (v !== undefined && v !== null && String(v).toLowerCase().includes(q)) out.push({ row: ri, col: ci });
      })
    );
    return out;
  }, [gridData, searchQuery]);

  const searchMatchKeys = useMemo(() => new Set(searchMatches.map((m) => `${m.row}:${m.col}`)), [searchMatches]);
  const currentMatchKey =
    searchMatches.length > 0 && searchIndex < searchMatches.length
      ? `${searchMatches[searchIndex].row}:${searchMatches[searchIndex].col}`
      : null;

  useEffect(() => {
    if (!searchQuery.trim() || searchMatches.length === 0) return;
    setSearchIndex(0);
    spreadsheetRef.current?.activate({ row: searchMatches[0].row, column: searchMatches[0].col });
    // Only re-jump when the query itself changes, not every recompute of searchMatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const goToMatch = useCallback(
    (index: number) => {
      if (searchMatches.length === 0) return;
      const clamped = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setSearchIndex(clamped);
      const m = searchMatches[clamped];
      spreadsheetRef.current?.activate({ row: m.row, column: m.col });
    },
    [searchMatches]
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchIndex(0);
  }, []);

  const gridContextValue = useMemo(
    () => ({
      containerRef: gridContainerRef,
      rowCount: gridData.length,
      colCount: gridData[0]?.length ?? 0,
      searchMatches: searchMatchKeys,
      currentMatchKey,
    }),
    [gridData, searchMatchKeys, currentMatchKey]
  );

  // ── Fill handle (vertical drag-fill, like Excel's fill handle) ─────────
  const applyFill = useCallback((drag: { startRow: number; col: number; toRow: number }) => {
    const wb = workbookRef.current;
    const sheet = activeSheetRef.current;
    if (!wb || !sheet || drag.toRow <= drag.startRow) return;
    const ws = wb.Sheets[sheet];
    const { startRow, startCol } = rangeOffsetRef.current;
    const sourceMatrix = lastGridDataRef.current;
    const sourceValue = sourceMatrix[drag.startRow]?.[drag.col]?.value;
    if (sourceValue === undefined || sourceValue === null || sourceValue === "") return;

    const nextMatrix = sourceMatrix.map((r) => r.slice());
    for (let r = drag.startRow + 1; r <= drag.toRow; r++) {
      const delta = r - drag.startRow;
      const isSourceFormula = typeof sourceValue === "string" && sourceValue.startsWith("=") && sourceValue.length > 1;
      const filledValue = isSourceFormula ? `=${shiftFormulaRows(sourceValue.slice(1), delta)}` : sourceValue;
      if (!nextMatrix[r]) nextMatrix[r] = [];
      nextMatrix[r][drag.col] = { value: filledValue, className: isSourceFormula ? "sheet-editor-formula-cell" : undefined };
      const cellRef = XLSX.utils.encode_cell({ r: startRow + r, c: startCol + drag.col });
      applyCellEdit(ws, cellRef, filledValue);
    }
    lastGridDataRef.current = nextMatrix;
    setGridData(nextMatrix);
    setDirty(true);
  }, []);

  const startFillDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (!activeCell) return;
      e.preventDefault();
      e.stopPropagation();
      const drag = { startRow: activeCell.row, col: activeCell.column, toRow: activeCell.row };
      fillDragRef.current = drag;
      setFillPreview(drag);
    },
    [activeCell]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = fillDragRef.current;
      if (!drag) return;
      const row = rowIndexAtY(gridContainerRef.current, e.clientY);
      if (row < 0) return;
      const clamped = Math.min(Math.max(row, drag.startRow), lastGridDataRef.current.length - 1);
      if (clamped !== drag.toRow) {
        const next = { ...drag, toRow: clamped };
        fillDragRef.current = next;
        setFillPreview(next);
      }
    };
    const handleUp = () => {
      if (fillDragRef.current) {
        applyFill(fillDragRef.current);
        fillDragRef.current = null;
        setFillPreview(null);
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [applyFill]);

  useLayoutEffect(() => {
    if (gridMode !== "view" || !activeCell) {
      setFillHandleRect(null);
      return;
    }
    const recompute = () => {
      const el = gridContainerRef.current?.querySelector<HTMLElement>(".Spreadsheet__active-cell");
      setFillHandleRect(el ? rectFromElement(el) : null);
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [gridMode, activeCell, gridData]);

  const fillPreviewRect = useMemo((): Rect | null => {
    if (!fillPreview || fillPreview.toRow <= fillPreview.startRow) return null;
    const startEl = getDataCellElement(gridContainerRef.current, fillPreview.startRow + 1, fillPreview.col);
    const endEl = getDataCellElement(gridContainerRef.current, fillPreview.toRow, fillPreview.col);
    if (!startEl || !endEl) return null;
    const a = rectFromElement(startEl);
    const b = rectFromElement(endEl);
    return { top: a.top, left: a.left, width: Math.max(a.width, b.width), height: b.top + b.height - a.top };
    // Recompute whenever the drag range or the grid layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillPreview, gridData]);

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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            disabled={state !== "ready"}
            className="btn-ghost gap-2 rounded-full p-2 disabled:opacity-60"
            aria-label={titleCase("Find in sheet")}
            title={titleCase("Find in sheet")}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={!dirty || saving || state !== "ready"}
            className="btn-primary gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? titleCase("Saving…") : dirty ? titleCase("Save") : titleCase("Saved")}
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToMatch(e.shiftKey ? searchIndex - 1 : searchIndex + 1);
              if (e.key === "Escape") closeSearch();
            }}
            placeholder={titleCase("Find in this sheet…")}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
          />
          <span className="shrink-0 text-xs text-[var(--color-text-faint)]">
            {searchQuery.trim() === ""
              ? ""
              : searchMatches.length === 0
                ? titleCase("No matches")
                : `${searchIndex + 1} / ${searchMatches.length}`}
          </span>
          <button
            type="button"
            onClick={() => goToMatch(searchIndex - 1)}
            disabled={searchMatches.length === 0}
            className="btn-ghost rounded-full p-1.5 disabled:opacity-40"
            aria-label={titleCase("Previous match")}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => goToMatch(searchIndex + 1)}
            disabled={searchMatches.length === 0}
            className="btn-ghost rounded-full p-1.5 disabled:opacity-40"
            aria-label={titleCase("Next match")}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="btn-ghost rounded-full p-1.5"
            aria-label={titleCase("Close search")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

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

      {sheetSwitchWarning ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{sheetSwitchWarning}</span>
          <button type="button" className="btn-ghost" onClick={() => setSheetSwitchWarning(null)}>
            {titleCase("Dismiss")}
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
            <p>{titleCase("This file is too large to edit in-app (too many rows/columns, or over 5MB).")}</p>
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
            <div ref={gridContainerRef} className="relative inline-block min-w-full">
              <SheetEditorGridContext.Provider value={gridContextValue}>
                <Spreadsheet
                  ref={spreadsheetRef}
                  data={gridData}
                  onChange={handleGridChange}
                  DataEditor={SheetDataEditor}
                  DataViewer={SheetDataViewer}
                  onActivate={setActiveCell}
                  onModeChange={setGridMode}
                />
              </SheetEditorGridContext.Provider>
              {fillHandleRect
                ? createPortal(
                    <div
                      className="sheet-editor-fill-handle"
                      style={{
                        position: "fixed",
                        top: fillHandleRect.top + fillHandleRect.height - 4,
                        left: fillHandleRect.left + fillHandleRect.width - 4,
                      }}
                      onMouseDown={startFillDrag}
                      title={titleCase("Drag down to fill")}
                    />,
                    document.body
                  )
                : null}
              {fillPreviewRect
                ? createPortal(
                    <div
                      className="sheet-editor-fill-preview"
                      style={{
                        position: "fixed",
                        top: fillPreviewRect.top,
                        left: fillPreviewRect.left,
                        width: fillPreviewRect.width,
                        height: fillPreviewRect.height,
                      }}
                    />,
                    document.body
                  )
                : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
