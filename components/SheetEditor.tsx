"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  Plus, Trash2, Snowflake, RefreshCw, Loader2, Undo2, Redo2,
  BarChart3, ExternalLink, X, TableCellsMerge, TableCellsSplit, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types mirrored from lib/sheets.ts ── */
type SheetCell = {
  display: string;
  raw: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  fontSize?: number;
  textColor?: string;
  bgColor?: string;
  align?: string;
};
type SheetTab = {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
  frozenColumnCount: number;
};
type SpreadsheetMeta = { spreadsheetId: string; title: string; tabs: SheetTab[] };
type MergeRange = { startRow: number; endRow: number; startCol: number; endCol: number };
type SheetData = {
  title: string;
  cells: SheetCell[][];
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
  columnWidths: number[];
  rowHeights: number[];
  merges: MergeRange[];
};

type Pos = { row: number; col: number };

const DEFAULT_COL_W = 120;
const ROW_H = 28;
const HEADER_H = 24;
const ROWNUM_W = 48;
const MIN_ROW_H = 20;
const MIN_COL_W = 40;

function colToLetter(col: number): string {
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function SheetEditor({ spreadsheetId }: { spreadsheetId: string }) {
  const [meta, setMeta] = useState<SpreadsheetMeta | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // `selected` is the active (focus) cell; `anchor` is the other corner of
  // the selection rectangle. When they're equal, a single cell is selected.
  const [selected, setSelected] = useState<Pos>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Pos>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<Pos | null>(null);
  const [editValue, setEditValue] = useState("");

  const editInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // In-app clipboard: a 2-D block of raw values copied/cut from a range.
  const clipboardRef = useRef<string[][] | null>(null);
  // Live refs so background save callbacks read current state without stale
  // closures (avoids re-creating the save fn on every keystroke).
  const dataRef = useRef<SheetData | null>(null);
  const editingRef = useRef<Pos | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  // Right-click context menu for a tab: { sheetId, title, x, y } or null.
  const [tabMenu, setTabMenu] = useState<{ sheetId: number; title: string; x: number; y: number } | null>(null);
  // Live column-width overrides while dragging (col index → px). Cleared
  // after the resize is persisted and data reloads.
  const [colWidthOverride, setColWidthOverride] = useState<Record<number, number>>({});
  const resizeRef = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const colWidth = useCallback(
    (c: number): number => {
      if (colWidthOverride[c] != null) return colWidthOverride[c];
      const w = data?.columnWidths?.[c];
      return w && w > 0 ? w : DEFAULT_COL_W;
    },
    [colWidthOverride, data]
  );

  const [rowHeightOverride, setRowHeightOverride] = useState<Record<number, number>>({});
  const rowResizeRef = useRef<{ row: number; startY: number; startH: number } | null>(null);

  const rowHeight = useCallback(
    (r: number): number => {
      if (rowHeightOverride[r] != null) return rowHeightOverride[r];
      const h = data?.rowHeights?.[r];
      return h && h > 0 ? h : ROW_H;
    },
    [rowHeightOverride, data]
  );

  // Drag-fill: while dragging the corner handle, this holds the target cell
  // the pointer is over; on release we fill the source selection into it.
  const fillRef = useRef(false);
  const [fillTarget, setFillTarget] = useState<Pos | null>(null);

  // Undo/redo: each entry restores a rectangular block of raw values.
  type HistoryEntry = {
    sheet: string;
    startRow: number;
    startCol: number;
    before: string[][];
    after: string[][];
  };
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const [historyTick, setHistoryTick] = useState(0); // forces toolbar re-render

  // Charts on the active tab + the insert-chart type picker open state.
  type ChartInfo = { chartId: number; title: string; type: string };
  const [charts, setCharts] = useState<ChartInfo[]>([]);
  const [chartMenuOpen, setChartMenuOpen] = useState(false);

  // Row virtualization: render only rows in/near the viewport.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  // Normalized selection rectangle (top-left → bottom-right).
  const selRect = useMemo(() => {
    const r1 = Math.min(anchor.row, selected.row);
    const r2 = Math.max(anchor.row, selected.row);
    const c1 = Math.min(anchor.col, selected.col);
    const c2 = Math.max(anchor.col, selected.col);
    return { r1, r2, c1, c2 };
  }, [anchor, selected]);

  const inSelection = useCallback(
    (row: number, col: number) =>
      row >= selRect.r1 && row <= selRect.r2 && col >= selRect.c1 && col <= selRect.c2,
    [selRect]
  );

  /** Move focus cell and collapse the selection to it (single-cell select). */
  const selectCell = useCallback((pos: Pos) => {
    setSelected(pos);
    setAnchor(pos);
  }, []);

  /** Extend the selection: keep the anchor, move only the focus cell. */
  const extendTo = useCallback((pos: Pos) => {
    setSelected(pos);
  }, []);

  /** Select an entire column (click on its letter header). */
  const selectColumn = useCallback((col: number) => {
    if (!data) return;
    setAnchor({ row: 0, col });
    setSelected({ row: data.rowCount - 1, col });
  }, [data]);

  /** Select an entire row (click on its number). */
  const selectRow = useCallback((row: number) => {
    if (!data) return;
    setAnchor({ row, col: 0 });
    setSelected({ row, col: data.columnCount - 1 });
  }, [data]);

  const activeTab = useMemo(
    () => meta?.tabs.find((t) => t.title === activeSheet) ?? null,
    [meta, activeSheet]
  );

  /* ── Load a tab ── */
  const loadSheet = useCallback(
    async (sheet?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/data${qs}`, {
          cache: "no-store",
        });
        const j = (await res.json()) as {
          meta?: SpreadsheetMeta;
          activeSheet?: string;
          data?: SheetData;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Failed to load spreadsheet");
        if (j.meta) setMeta(j.meta);
        if (j.activeSheet) setActiveSheet(j.activeSheet);
        if (j.data) setData(j.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    },
    [spreadsheetId]
  );

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  // End drag-select when the mouse is released anywhere.
  useEffect(() => {
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  // Track the grid viewport height so the virtualization window is accurate.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // Column-resize drag: track mouse globally so the drag continues even when
  // the cursor leaves the thin handle. On release, persist the new width.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const rs = resizeRef.current;
      if (!rs) return;
      const next = Math.max(MIN_COL_W, rs.startW + (e.clientX - rs.startX));
      setColWidthOverride((prev) => ({ ...prev, [rs.col]: next }));
    }
    async function onUp() {
      const rs = resizeRef.current;
      if (!rs || !activeTab) return;
      resizeRef.current = null;
      const finalW = colWidthOverride[rs.col] ?? rs.startW;
      try {
        await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "colwidth",
            sheetId: activeTab.sheetId,
            columnIndex: rs.col,
            pixelSize: Math.round(finalW),
          }),
        });
        // Persist into data so the override can be dropped.
        setData((d) => {
          if (!d) return d;
          const widths = d.columnWidths.slice();
          widths[rs.col] = Math.round(finalW);
          return { ...d, columnWidths: widths };
        });
        setColWidthOverride((prev) => {
          const { [rs.col]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        });
      } catch {
        /* keep the override on failure so the UI still reflects the drag */
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [activeTab, spreadsheetId, colWidthOverride]);

  // Row-resize drag (mirror of column resize).
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const rs = rowResizeRef.current;
      if (!rs) return;
      const next = Math.max(MIN_ROW_H, rs.startH + (e.clientY - rs.startY));
      setRowHeightOverride((prev) => ({ ...prev, [rs.row]: next }));
    }
    async function onUp() {
      const rs = rowResizeRef.current;
      if (!rs || !activeTab) return;
      rowResizeRef.current = null;
      const finalH = rowHeightOverride[rs.row] ?? rs.startH;
      try {
        await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "rowheight",
            sheetId: activeTab.sheetId,
            rowIndex: rs.row,
            pixelSize: Math.round(finalH),
          }),
        });
        setData((d) => {
          if (!d) return d;
          const heights = d.rowHeights.slice();
          heights[rs.row] = Math.round(finalH);
          return { ...d, rowHeights: heights };
        });
        setRowHeightOverride((prev) => {
          const { [rs.row]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        });
      } catch {
        /* keep override on failure */
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [activeTab, spreadsheetId, rowHeightOverride]);

  /* ── Cell helpers ── */
  function cellAt(row: number, col: number): SheetCell {
    return data?.cells[row]?.[col] ?? { display: "", raw: "" };
  }

  /* ── Editing ── */
  const beginEdit = useCallback(
    (pos: Pos, initial?: string) => {
      const c = cellAt(pos.row, pos.col);
      setEditing(pos);
      setEditValue(initial !== undefined ? initial : c.raw);
      requestAnimationFrame(() => editInputRef.current?.focus());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  /** Push an undo entry and clear the redo stack (new action branch). */
  const recordHistory = useCallback((entry: HistoryEntry) => {
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  // Tracks how many cell-saves are in flight so we only re-pull computed
  // formula values once the writes settle (avoids clobbering fast typing).
  const pendingSavesRef = useRef(0);

  /**
   * Persist a single cell in the background. Does NOT block the UI — the
   * optimistic value is already on screen, so the user can keep typing in
   * the next cell immediately (Gmail/Sheets-style). After the write settles
   * we only re-pull computed values if the sheet actually has formulas, and
   * we never overwrite the cell the user is currently editing.
   */
  const saveCellBackground = useCallback(
    (sheet: string, row: number, col: number, value: string) => {
      pendingSavesRef.current += 1;
      setSaving(true);
      fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet, row, col, value }),
      })
        .then(async (res) => {
          const j = (await res.json()) as { ok?: boolean; values?: string[][]; error?: string };
          if (!res.ok) throw new Error(j.error || "Save failed");
          // Only the LAST settling save refreshes formula results, and only
          // if a formula exists somewhere — plain text needs no server echo.
          const lastInFlight = pendingSavesRef.current === 1;
          const hasFormula =
            j.values != null &&
            (dataRef.current?.cells.some((r) => r.some((c) => c.raw.startsWith("="))) ?? false);
          if (lastInFlight && hasFormula && j.values) {
            const vals = j.values;
            setData((d) => {
              if (!d) return d;
              const cells = d.cells.map((r) => r.slice());
              for (let r = 0; r < d.rowCount; r++) {
                for (let c = 0; c < d.columnCount; c++) {
                  // Never stomp the cell being actively edited.
                  if (editingRef.current && editingRef.current.row === r && editingRef.current.col === c) continue;
                  const display = vals[r]?.[c] ?? "";
                  const existing = cells[r]?.[c] ?? { display: "", raw: "" };
                  if (cells[r]) cells[r][c] = { ...existing, display };
                }
              }
              return { ...d, cells };
            });
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Save failed");
        })
        .finally(() => {
          pendingSavesRef.current -= 1;
          if (pendingSavesRef.current <= 0) {
            pendingSavesRef.current = 0;
            setSaving(false);
          }
        });
    },
    [spreadsheetId]
  );

  const commitEdit = useCallback(
    (move?: Pos) => {
      if (!editing || !activeSheet) {
        setEditing(null);
        if (move) selectCell(move);
        return;
      }
      const pos = editing;
      const value = editValue;
      const prev = cellAt(pos.row, pos.col);
      setEditing(null);
      if (move) selectCell(move);

      if (value === prev.raw) return; // no change

      // Record for undo (before/after of the single cell).
      recordHistory({
        sheet: activeSheet,
        startRow: pos.row,
        startCol: pos.col,
        before: [[prev.raw]],
        after: [[value]],
      });

      // Optimistic display update — instant; user can keep typing.
      setData((d) => {
        if (!d) return d;
        const cells = d.cells.map((r) => r.slice());
        cells[pos.row] = cells[pos.row] ? cells[pos.row].slice() : [];
        cells[pos.row][pos.col] = { ...prev, raw: value, display: value };
        return { ...d, cells };
      });

      // Fire-and-forget the network write.
      saveCellBackground(activeSheet, pos.row, pos.col, value);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, editValue, activeSheet, saveCellBackground]
  );

  /** Apply a fresh computed-values matrix from the server onto the grid. */
  const applyValuesRefresh = useCallback((values: string[][]) => {
    setData((d) => {
      if (!d) return d;
      const cells = d.cells.map((r) => r.slice());
      for (let r = 0; r < d.rowCount; r++) {
        for (let c = 0; c < d.columnCount; c++) {
          const display = values?.[r]?.[c] ?? "";
          const existing = cells[r]?.[c] ?? { display: "", raw: "" };
          if (cells[r]) cells[r][c] = { ...existing, display };
        }
      }
      return { ...d, cells };
    });
  }, []);

  /** Snapshot a rectangle's raw values (for undo history). */
  const snapshotBlock = useCallback(
    (r1: number, c1: number, r2: number, c2: number): string[][] => {
      const block: string[][] = [];
      for (let r = r1; r <= r2; r++) {
        const row: string[] = [];
        for (let c = c1; c <= c2; c++) row.push(data?.cells[r]?.[c]?.raw ?? "");
        block.push(row);
      }
      return block;
    },
    [data]
  );

  /** Clear all values in the current selection rectangle. */
  const clearSelection = useCallback(async () => {
    if (!activeSheet) return;
    const { r1, r2, c1, c2 } = selRect;
    // Record for undo: before = current values, after = all empty.
    const before = snapshotBlock(r1, c1, r2, c2);
    const after = before.map((row) => row.map(() => ""));
    recordHistory({ sheet: activeSheet, startRow: r1, startCol: c1, before, after });
    // Optimistic clear.
    setData((d) => {
      if (!d) return d;
      const cells = d.cells.map((r) => r.slice());
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (cells[r]?.[c]) cells[r][c] = { ...cells[r][c], raw: "", display: "" };
        }
      }
      return { ...d, cells };
    });
    setSaving(true);
    try {
      const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet: activeSheet, mode: "clear", row: r1, col: c1, endRow: r2, endCol: c2 }),
      });
      const j = (await res.json()) as { values?: string[][]; error?: string };
      if (!res.ok) throw new Error(j.error || "Clear failed");
      if (j.values) applyValuesRefresh(j.values);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
      void loadSheet(activeSheet);
    } finally {
      setSaving(false);
    }
  }, [activeSheet, selRect, spreadsheetId, applyValuesRefresh, loadSheet, snapshotBlock, recordHistory]);

  /** Copy the raw values of the current selection into the in-app clipboard. */
  const copySelection = useCallback(() => {
    if (!data) return;
    const { r1, r2, c1, c2 } = selRect;
    const block: string[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row: string[] = [];
      for (let c = c1; c <= c2; c++) row.push(data.cells[r]?.[c]?.raw ?? "");
      block.push(row);
    }
    clipboardRef.current = block;
    // Also push to the OS clipboard as TSV so paste into other apps works.
    try {
      void navigator.clipboard?.writeText(block.map((r) => r.join("\t")).join("\n"));
    } catch { /* clipboard may be unavailable; in-app copy still works */ }
  }, [data, selRect]);

  /** Write a 2-D block anchored at (startRow, startCol). */
  const writeRange = useCallback(
    async (startRow: number, startCol: number, values: string[][], recordUndo = true) => {
      if (!activeSheet || !values.length) return;
      if (recordUndo) {
        const r2 = startRow + values.length - 1;
        const c2 = startCol + Math.max(...values.map((row) => row.length)) - 1;
        const before = snapshotBlock(startRow, startCol, r2, c2);
        recordHistory({ sheet: activeSheet, startRow, startCol, before, after: values });
      }
      // Optimistic display.
      setData((d) => {
        if (!d) return d;
        const cells = d.cells.map((r) => r.slice());
        for (let i = 0; i < values.length; i++) {
          for (let j = 0; j < values[i].length; j++) {
            const r = startRow + i;
            const c = startCol + j;
            if (cells[r]) {
              const existing = cells[r][c] ?? { display: "", raw: "" };
              cells[r][c] = { ...existing, raw: values[i][j], display: values[i][j] };
            }
          }
        }
        return { ...d, cells };
      });
      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/data`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheet: activeSheet, mode: "range", row: startRow, col: startCol, values }),
        });
        const j = (await res.json()) as { values?: string[][]; error?: string };
        if (!res.ok) throw new Error(j.error || "Paste failed");
        if (j.values) applyValuesRefresh(j.values);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Paste failed");
        void loadSheet(activeSheet);
      } finally {
        setSaving(false);
      }
    },
    [activeSheet, spreadsheetId, applyValuesRefresh, loadSheet, snapshotBlock, recordHistory]
  );

  /** Undo / redo: restore a recorded block, then push to the opposite stack. */
  const doHistory = useCallback(
    async (dir: "undo" | "redo") => {
      const from = dir === "undo" ? undoStackRef.current : redoStackRef.current;
      const to = dir === "undo" ? redoStackRef.current : undoStackRef.current;
      const entry = from.pop();
      if (!entry) return;
      to.push(entry);
      setHistoryTick((t) => t + 1);
      const values = dir === "undo" ? entry.before : entry.after;
      // Switch to the entry's sheet if needed, then write without re-recording.
      if (entry.sheet !== activeSheet) await loadSheet(entry.sheet);
      await writeRange(entry.startRow, entry.startCol, values, false);
    },
    [activeSheet, loadSheet, writeRange]
  );

  /** Commit a drag-fill: replicate the source selection into the fill range. */
  const commitFill = useCallback(async () => {
    if (!data) return;
    const target = fillTarget;
    fillRef.current = false;
    setFillTarget(null);
    if (!target) return;
    const { r1, r2, c1, c2 } = selRect;
    const srcH = r2 - r1 + 1;
    const srcW = c2 - c1 + 1;
    // Fill direction: down if target row beyond selection, else right.
    const fillDown = target.row > r2;
    const fillRight = target.col > c2 && !fillDown;
    if (!fillDown && !fillRight) return;

    const block: string[][] = [];
    if (fillDown) {
      const startR = r2 + 1;
      for (let r = startR; r <= target.row; r++) {
        const srcRow = (r - r1) % srcH;
        const row: string[] = [];
        for (let c = c1; c <= c2; c++) row.push(data.cells[r1 + srcRow]?.[c]?.raw ?? "");
        block.push(row);
      }
      if (block.length) await writeRange(startR, c1, block);
    } else {
      // fillRight
      for (let r = r1; r <= r2; r++) {
        const row: string[] = [];
        for (let c = c2 + 1; c <= target.col; c++) {
          const srcCol = (c - c1) % srcW;
          row.push(data.cells[r]?.[c1 + srcCol]?.raw ?? "");
        }
        block.push(row);
      }
      if (block[0]?.length) await writeRange(r1, c2 + 1, block);
    }
  }, [data, fillTarget, selRect, writeRange]);

  // End a drag-fill on mouse release anywhere.
  useEffect(() => {
    const onUp = () => { if (fillRef.current) void commitFill(); };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [commitFill]);

  /** Paste: prefer the in-app clipboard; fall back to OS clipboard (TSV). */
  const pasteClipboard = useCallback(async () => {
    let block = clipboardRef.current;
    if (!block) {
      try {
        const text = await navigator.clipboard?.readText();
        if (text) block = text.split(/\r?\n/).map((line) => line.split("\t"));
      } catch { /* ignore */ }
    }
    if (!block || !block.length) return;
    await writeRange(selRect.r1, selRect.c1, block);
  }, [selRect, writeRange]);

  /* ── Keyboard navigation on the grid ── */
  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return; // input handles its own keys
      if (!data) return;
      const { row, col } = selected;
      const maxR = data.rowCount - 1;
      const maxC = data.columnCount - 1;
      const meta = e.metaKey || e.ctrlKey;

      // Undo / redo.
      if (meta && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); void doHistory("undo"); return; }
      if (meta && ((e.key === "z" || e.key === "Z") && e.shiftKey || e.key === "y" || e.key === "Y")) { e.preventDefault(); void doHistory("redo"); return; }

      // Clipboard shortcuts.
      if (meta && (e.key === "c" || e.key === "C")) { e.preventDefault(); copySelection(); return; }
      if (meta && (e.key === "x" || e.key === "X")) { e.preventDefault(); copySelection(); void clearSelection(); return; }
      if (meta && (e.key === "v" || e.key === "V")) { e.preventDefault(); void pasteClipboard(); return; }
      if (meta && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setAnchor({ row: 0, col: 0 });
        setSelected({ row: maxR, col: maxC });
        return;
      }

      // Shift+arrow extends the selection; plain arrow moves + collapses.
      const moveOrExtend = (p: Pos) => { if (e.shiftKey) extendTo(p); else selectCell(p); };
      if (e.key === "ArrowUp") { e.preventDefault(); moveOrExtend({ row: Math.max(0, row - 1), col }); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveOrExtend({ row: Math.min(maxR, row + 1), col }); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); moveOrExtend({ row, col: Math.max(0, col - 1) }); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moveOrExtend({ row, col: Math.min(maxC, col + 1) }); }
      else if (e.key === "Tab") { e.preventDefault(); selectCell({ row, col: Math.min(maxC, col + 1) }); }
      else if (e.key === "Enter") { e.preventDefault(); beginEdit(selected); }
      else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        void clearSelection();
      } else if (e.key.length === 1 && !meta && !e.altKey) {
        // Start typing replaces cell content.
        beginEdit(selected, e.key);
      }
    },
    [editing, data, selected, beginEdit, copySelection, clearSelection, pasteClipboard, extendTo, selectCell, doHistory]
  );

  /* ── Formatting actions ── */
  const applyFormat = useCallback(
    async (format: Record<string, unknown>) => {
      if (!activeTab) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "format",
            sheetId: activeTab.sheetId,
            startRow: selRect.r1,
            endRow: selRect.r2 + 1,
            startCol: selRect.c1,
            endCol: selRect.c2 + 1,
            format,
            refreshSheet: activeSheet,
          }),
        });
        const j = (await res.json()) as { data?: SheetData; error?: string };
        if (!res.ok) throw new Error(j.error || "Format failed");
        if (j.data) setData(j.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Format failed");
      } finally {
        setSaving(false);
      }
    },
    [activeTab, activeSheet, spreadsheetId, selRect]
  );

  const structuralOp = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!activeTab) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sheetId: activeTab.sheetId, refreshSheet: activeSheet }),
        });
        const j = (await res.json()) as { data?: SheetData; error?: string };
        if (!res.ok) throw new Error(j.error || "Operation failed");
        if (j.data) setData(j.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed");
      } finally {
        setSaving(false);
      }
    },
    [activeTab, activeSheet, spreadsheetId]
  );

  /** Tab management: add / delete / rename / move. Updates meta + active tab. */
  const tabOp = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/tabs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = (await res.json()) as { meta?: SpreadsheetMeta; newTabTitle?: string; error?: string };
        if (!res.ok) throw new Error(j.error || "Tab operation failed");
        if (j.meta) {
          setMeta(j.meta);
          // If the active tab was deleted, fall back to the first remaining one.
          const stillExists = j.meta.tabs.some((t) => t.title === activeSheet);
          const nextTab = j.newTabTitle || (stillExists ? activeSheet : j.meta.tabs[0]?.title);
          if (nextTab && nextTab !== activeSheet) void loadSheet(nextTab);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Tab operation failed");
      } finally {
        setSaving(false);
      }
    },
    [spreadsheetId, activeSheet, loadSheet]
  );

  // Close the tab context menu on any outside click.
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [tabMenu]);

  // Close the chart-type menu when clicking outside it.
  useEffect(() => {
    if (!chartMenuOpen) return;
    function onDown(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-chart-menu]")) setChartMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [chartMenuOpen]);

  /* ── Charts ── */
  const loadCharts = useCallback(async () => {
    if (!activeSheet) return;
    try {
      const res = await fetch(
        `/api/sheets/${encodeURIComponent(spreadsheetId)}/charts?sheet=${encodeURIComponent(activeSheet)}`,
        { cache: "no-store" }
      );
      const j = (await res.json()) as { charts?: ChartInfo[] };
      if (res.ok) setCharts(j.charts ?? []);
    } catch { /* non-fatal */ }
  }, [activeSheet, spreadsheetId]);

  // Refresh the chart list whenever the active tab changes.
  useEffect(() => {
    void loadCharts();
  }, [loadCharts]);

  const insertChart = useCallback(
    async (chartType: "COLUMN" | "BAR" | "LINE" | "PIE") => {
      if (!activeTab) return;
      setChartMenuOpen(false);
      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/charts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sheetId: activeTab.sheetId,
            startRow: selRect.r1,
            endRow: selRect.r2,
            startCol: selRect.c1,
            endCol: selRect.c2,
            chartType,
            title: "Chart",
          }),
        });
        const j = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(j.error || "Insert chart failed");
        await loadCharts();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Insert chart failed");
      } finally {
        setSaving(false);
      }
    },
    [activeTab, spreadsheetId, selRect, loadCharts]
  );

  const removeChart = useCallback(
    async (chartId: number) => {
      setSaving(true);
      try {
        const res = await fetch(
          `/api/sheets/${encodeURIComponent(spreadsheetId)}/charts?chartId=${chartId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error || "Delete chart failed");
        }
        await loadCharts();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete chart failed");
      } finally {
        setSaving(false);
      }
    },
    [spreadsheetId, loadCharts]
  );

  // Merge lookup: for each "covered" cell (not the top-left) we skip render;
  // the top-left cell spans the merge's column width. (Horizontal spans render
  // exactly; vertical spans blank the covered rows — content stays on top-left.)
  const mergeMap = useMemo(() => {
    const anchors = new Map<string, MergeRange>(); // "r,c" → merge (top-left)
    const covered = new Set<string>(); // "r,c" covered but not anchor
    for (const m of data?.merges ?? []) {
      anchors.set(`${m.startRow},${m.startCol}`, m);
      for (let r = m.startRow; r < m.endRow; r++) {
        for (let c = m.startCol; c < m.endCol; c++) {
          if (r === m.startRow && c === m.startCol) continue;
          covered.add(`${r},${c}`);
        }
      }
    }
    return { anchors, covered };
  }, [data]);

  const mergeSelection = useCallback(
    async (merge: boolean) => {
      if (!activeTab) return;
      const { r1, r2, c1, c2 } = selRect;
      await structuralOp({
        op: merge ? "merge" : "unmerge",
        startRow: r1, endRow: r2, startCol: c1, endCol: c2,
      });
    },
    [activeTab, selRect, structuralOp]
  );

  const [condFmtOpen, setCondFmtOpen] = useState(false);

  const selCell = data ? cellAt(selected.row, selected.col) : null;

  // Windowed rows: render a buffer of rows around the viewport. Frozen rows
  // always render (they're sticky at the top). Keeps large sheets snappy.
  const OVERSCAN = 8;
  const totalRows = data?.rowCount ?? 0;
  const frozen = data?.frozenRowCount ?? 0;
  const firstVisible = Math.max(frozen, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastVisible = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN
  );
  const topSpacer = Math.max(0, (firstVisible - frozen) * ROW_H);
  const bottomSpacer = Math.max(0, (totalRows - lastVisible) * ROW_H);

  /** Render a single grid row (used for both frozen and windowed rows). */
  function renderRow(r: number, isFrozen: boolean) {
    if (!data) return null;
    const rh = rowHeight(r);
    return (
      <div
        key={r}
        className={cn("flex", isFrozen && "sticky z-10 bg-[var(--color-surface)]")}
        style={isFrozen ? { top: HEADER_H + r * ROW_H } : undefined}
      >
        {/* Row number (click → select whole row; bottom edge → resize) */}
        <div
          onClick={() => { selectRow(r); gridRef.current?.focus(); }}
          className={cn(
            "sticky left-0 z-10 flex shrink-0 cursor-pointer items-center justify-center border-b border-r border-[var(--color-border)] bg-[var(--color-surface-offset)] text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]",
            inSelection(r, selRect.c1) && "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
          )}
          style={{ width: ROWNUM_W, height: rh, position: "relative" }}
        >
          {r + 1}
          <span
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              rowResizeRef.current = { row: r, startY: e.clientY, startH: rh };
            }}
            className="absolute bottom-0 left-0 z-10 h-1.5 w-full cursor-row-resize hover:bg-[var(--color-primary)]"
          />
        </div>
        {/* Cells */}
        {Array.from({ length: data.columnCount }).map((_, c) => {
          // Skip cells covered by a merge (the anchor renders the span).
          if (mergeMap.covered.has(`${r},${c}`)) return null;
          const cell = cellAt(r, c);
          // If this cell anchors a merge, span its columns' combined width.
          const merge = mergeMap.anchors.get(`${r},${c}`);
          const spanCols = merge ? merge.endCol - merge.startCol : 1;
          let cellW = 0;
          for (let cc = c; cc < c + spanCols; cc++) cellW += colWidth(cc);
          const isFocus = selected.row === r && selected.col === c;
          const isSel = inSelection(r, c);
          const isRange = isSel && !(selRect.r1 === selRect.r2 && selRect.c1 === selRect.c2);
          const isEdit = editing?.row === r && editing?.col === c;
          // Fill handle sits on the bottom-right corner of the selection.
          const isFillCorner = r === selRect.r2 && c === selRect.c2;
          // Highlight the prospective fill range while dragging the handle.
          const inFillPreview =
            fillTarget != null &&
            ((fillTarget.row > selRect.r2 && c >= selRect.c1 && c <= selRect.c2 && r > selRect.r2 && r <= fillTarget.row) ||
              (fillTarget.col > selRect.c2 && r >= selRect.r1 && r <= selRect.r2 && c > selRect.c2 && c <= fillTarget.col));
          return (
            <div
              key={c}
              onMouseDown={(e) => {
                if (editing) void commitEdit();
                if (e.shiftKey) {
                  extendTo({ row: r, col: c });
                } else {
                  draggingRef.current = true;
                  selectCell({ row: r, col: c });
                }
                gridRef.current?.focus();
              }}
              onMouseEnter={() => {
                if (fillRef.current) setFillTarget({ row: r, col: c });
                else if (draggingRef.current) extendTo({ row: r, col: c });
              }}
              onDoubleClick={() => beginEdit({ row: r, col: c })}
              className={cn(
                "relative shrink-0 cursor-cell overflow-hidden border-b border-r border-[var(--color-border)] px-1.5 text-[13px] text-[var(--color-text)]",
                isFocus && !isEdit && "ring-2 ring-inset ring-[var(--color-primary)]"
              )}
              style={{
                width: cellW,
                height: rh,
                lineHeight: `${rh - 2}px`,
                fontWeight: cell.bold ? 700 : undefined,
                fontStyle: cell.italic ? "italic" : undefined,
                fontSize: cell.fontSize ? `${cell.fontSize}px` : undefined,
                textDecoration: [
                  cell.underline ? "underline" : "",
                  cell.strikethrough ? "line-through" : "",
                ].filter(Boolean).join(" ") || undefined,
                color: cell.textColor || undefined,
                backgroundColor: cell.bgColor || undefined,
                textAlign: (cell.align?.toLowerCase() as "left" | "center" | "right") || "left",
              }}
            >
              {(isRange || inFillPreview) && (
                <span className="pointer-events-none absolute inset-0 bg-[var(--color-primary)] opacity-10" />
              )}
              {isEdit ? (
                <input
                  ref={editInputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => void commitEdit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitEdit({ row: Math.min(data.rowCount - 1, r + 1), col: c }); }
                    else if (e.key === "Tab") { e.preventDefault(); void commitEdit({ row: r, col: Math.min(data.columnCount - 1, c + 1) }); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditing(null); gridRef.current?.focus(); }
                  }}
                  className="absolute inset-0 z-10 h-full w-full border-2 border-[var(--color-primary)] bg-white px-1.5 text-[13px] text-black outline-none"
                />
              ) : (
                <span className="block truncate">{cell.display}</span>
              )}
              {/* Drag-fill handle */}
              {isFillCorner && !isEdit && (
                <span
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fillRef.current = true;
                    setFillTarget({ row: r, col: c });
                  }}
                  className="absolute -bottom-[3px] -right-[3px] z-20 h-2 w-2 cursor-crosshair rounded-[1px] bg-[var(--color-primary)]"
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Render ── */
  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }
  if (error && !data) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }
  if (!data) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div data-history={historyTick} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
        <ToolBtn title="Undo (Cmd+Z)" disabled={undoStackRef.current.length === 0} onClick={() => void doHistory("undo")}>
          <Undo2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Redo (Cmd+Shift+Z)" disabled={redoStackRef.current.length === 0} onClick={() => void doHistory("redo")}>
          <Redo2 className="h-4 w-4" />
        </ToolBtn>
        <Divider />
        <ToolBtn title="Bold" active={!!selCell?.bold} onClick={() => applyFormat({ bold: !selCell?.bold })}>
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Italic" active={!!selCell?.italic} onClick={() => applyFormat({ italic: !selCell?.italic })}>
          <Italic className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Underline" active={!!selCell?.underline} onClick={() => applyFormat({ underline: !selCell?.underline })}>
          <Underline className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Strikethrough" active={!!selCell?.strikethrough} onClick={() => applyFormat({ strikethrough: !selCell?.strikethrough })}>
          <Strikethrough className="h-4 w-4" />
        </ToolBtn>

        <Divider />

        {/* Text color */}
        <label className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded hover:bg-[var(--color-surface-offset)]" title="Text color">
          <span className="text-[13px] font-bold leading-none">A</span>
          <span className="absolute bottom-1 h-1 w-4 rounded" style={{ backgroundColor: selCell?.textColor || "#202124" }} />
          <input
            type="color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={selCell?.textColor || "#000000"}
            onChange={(e) => applyFormat({ textColor: e.target.value })}
          />
        </label>
        {/* Fill color */}
        <label className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded hover:bg-[var(--color-surface-offset)]" title="Fill color">
          <span className="h-4 w-4 rounded border border-[var(--color-border)]" style={{ backgroundColor: selCell?.bgColor || "#ffffff" }} />
          <input
            type="color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={selCell?.bgColor || "#ffffff"}
            onChange={(e) => applyFormat({ bgColor: e.target.value })}
          />
        </label>

        <Divider />

        <ToolBtn title="Align left" active={selCell?.align === "LEFT" || !selCell?.align} onClick={() => applyFormat({ align: "LEFT" })}>
          <AlignLeft className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Align center" active={selCell?.align === "CENTER"} onClick={() => applyFormat({ align: "CENTER" })}>
          <AlignCenter className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Align right" active={selCell?.align === "RIGHT"} onClick={() => applyFormat({ align: "RIGHT" })}>
          <AlignRight className="h-4 w-4" />
        </ToolBtn>

        <Divider />

        {/* Font size */}
        <select
          title="Font size"
          value={selCell?.fontSize ?? 10}
          onChange={(e) => applyFormat({ fontSize: parseInt(e.target.value, 10) })}
          className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[12px] text-[var(--color-text)]"
        >
          {[8, 9, 10, 11, 12, 14, 16, 18, 24, 36].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <Divider />

        {/* Number formats */}
        <button type="button" title="Currency" onClick={() => applyFormat({ numberFormat: { type: "CURRENCY", pattern: "\"$\"#,##0.00" } })} className="flex h-8 w-8 items-center justify-center rounded text-[13px] hover:bg-[var(--color-surface-offset)]">$</button>
        <button type="button" title="Percent" onClick={() => applyFormat({ numberFormat: { type: "PERCENT", pattern: "0.00%" } })} className="flex h-8 w-8 items-center justify-center rounded text-[13px] hover:bg-[var(--color-surface-offset)]">%</button>
        <button type="button" title="Number (1,000.00)" onClick={() => applyFormat({ numberFormat: { type: "NUMBER", pattern: "#,##0.00" } })} className="flex h-8 items-center justify-center rounded px-1.5 text-[12px] hover:bg-[var(--color-surface-offset)]">1.0</button>
        <button type="button" title="Date" onClick={() => applyFormat({ numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } })} className="flex h-8 items-center justify-center rounded px-1.5 text-[12px] hover:bg-[var(--color-surface-offset)]">Date</button>
        <button type="button" title="Plain text" onClick={() => applyFormat({ numberFormat: { type: "TEXT" } })} className="flex h-8 items-center justify-center rounded px-1.5 text-[12px] hover:bg-[var(--color-surface-offset)]">Abc</button>

        <Divider />

        <ToolBtn title="Insert row above" onClick={() => structuralOp({ op: "insert", dimension: "ROWS", startIndex: selected.row, count: 1 })}>
          <span className="flex items-center"><Plus className="h-3.5 w-3.5" /><span className="ml-0.5 text-[11px]">R</span></span>
        </ToolBtn>
        <ToolBtn title="Insert column left" onClick={() => structuralOp({ op: "insert", dimension: "COLUMNS", startIndex: selected.col, count: 1 })}>
          <span className="flex items-center"><Plus className="h-3.5 w-3.5" /><span className="ml-0.5 text-[11px]">C</span></span>
        </ToolBtn>
        <ToolBtn title="Delete row" onClick={() => structuralOp({ op: "delete", dimension: "ROWS", startIndex: selected.row, count: 1 })}>
          <span className="flex items-center"><Trash2 className="h-3.5 w-3.5" /><span className="ml-0.5 text-[11px]">R</span></span>
        </ToolBtn>
        <ToolBtn title="Delete column" onClick={() => structuralOp({ op: "delete", dimension: "COLUMNS", startIndex: selected.col, count: 1 })}>
          <span className="flex items-center"><Trash2 className="h-3.5 w-3.5" /><span className="ml-0.5 text-[11px]">C</span></span>
        </ToolBtn>

        <Divider />

        <ToolBtn
          title={data.frozenRowCount > 0 ? "Unfreeze rows" : "Freeze row 1"}
          active={data.frozenRowCount > 0}
          onClick={() => structuralOp({ op: "freeze", frozenRowCount: data.frozenRowCount > 0 ? 0 : 1 })}
        >
          <Snowflake className="h-4 w-4" />
        </ToolBtn>

        <Divider />

        {/* Insert chart */}
        <div className="relative" data-chart-menu>
          <ToolBtn
            title="Insert chart over selection"
            active={chartMenuOpen}
            onClick={() => setChartMenuOpen((v) => !v)}
          >
            <BarChart3 className="h-4 w-4" />
          </ToolBtn>
          {chartMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {(["COLUMN", "BAR", "LINE", "PIE"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void insertChart(t)}
                  className="flex w-full items-center px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
                >
                  {t.charAt(0) + t.slice(1).toLowerCase()} chart
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* Merge / unmerge */}
        <ToolBtn title="Merge cells" onClick={() => void mergeSelection(true)}>
          <TableCellsMerge className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Unmerge cells" onClick={() => void mergeSelection(false)}>
          <TableCellsSplit className="h-4 w-4" />
        </ToolBtn>

        {/* Conditional formatting */}
        <ToolBtn title="Conditional formatting" active={condFmtOpen} onClick={() => setCondFmtOpen(true)}>
          <Palette className="h-4 w-4" />
        </ToolBtn>

        <div className="ml-auto flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" />}
          <ToolBtn title="Refresh" onClick={() => void loadSheet(activeSheet)}>
            <RefreshCw className="h-4 w-4" />
          </ToolBtn>
        </div>
      </div>

      {/* Formula/value bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1">
        <span className="w-16 shrink-0 text-[12px] font-semibold text-[var(--color-text-muted)]">
          {colToLetter(selected.col)}{selected.row + 1}
        </span>
        <span className="h-4 w-px bg-[var(--color-border)]" />
        <span className="truncate text-[13px] text-[var(--color-text)]">{selCell?.raw || ""}</span>
      </div>

      {/* Charts strip — lists charts on this tab (view in Sheets / delete) */}
      {charts.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-1.5">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
          {charts.map((ch) => (
            <span
              key={ch.chartId}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-text)]"
            >
              <span className="font-medium">{ch.title}</span>
              <span className="text-[10px] uppercase text-[var(--color-text-faint)]">{ch.type}</span>
              <a
                href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                title="View in Google Sheets"
                className="text-[var(--color-text-faint)] hover:text-[var(--color-primary)]"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
              <button
                type="button"
                title="Delete chart"
                onClick={() => void removeChart(ch.chartId)}
                className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="shrink-0 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Grid */}
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="flex-1 overflow-auto bg-[var(--color-surface)] outline-none"
      >
        <div className="inline-block min-w-full">
          {/* Column headers */}
          <div className="sticky top-0 z-20 flex bg-[var(--color-surface-offset)]">
            <div
              className="sticky left-0 z-30 shrink-0 border-b border-r border-[var(--color-border)] bg-[var(--color-surface-offset)]"
              style={{ width: ROWNUM_W, height: HEADER_H }}
            />
            {Array.from({ length: data.columnCount }).map((_, c) => (
              <div
                key={c}
                onClick={() => { selectColumn(c); gridRef.current?.focus(); }}
                className={cn(
                  "relative flex shrink-0 cursor-pointer items-center justify-center border-b border-r border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]",
                  inSelection(selRect.r1, c) && "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                )}
                style={{ width: colWidth(c), height: HEADER_H }}
              >
                {colToLetter(c)}
                {/* Resize handle on the right edge */}
                <span
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeRef.current = { col: c, startX: e.clientX, startW: colWidth(c) };
                  }}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-[var(--color-primary)]"
                />
              </div>
            ))}
          </div>

          {/* Frozen rows (always rendered, sticky under the header) */}
          {Array.from({ length: frozen }).map((_, r) => renderRow(r, true))}

          {/* Top spacer for virtualized scroll region */}
          {topSpacer > 0 && <div style={{ height: topSpacer }} />}

          {/* Windowed (visible) rows */}
          {Array.from({ length: Math.max(0, lastVisible - firstVisible) }).map((_, i) =>
            renderRow(firstVisible + i, false)
          )}

          {/* Bottom spacer */}
          {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
        </div>
      </div>

      {/* Tab bar */}
      {meta && meta.tabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-2 py-1">
          <button
            type="button"
            title="Add sheet"
            onClick={() => void tabOp({ op: "add" })}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            <Plus className="h-4 w-4" />
          </button>
          {meta.tabs.map((t) => (
            <button
              key={t.sheetId}
              type="button"
              onClick={() => { if (t.title !== activeSheet) void loadSheet(t.title); }}
              onDoubleClick={() => {
                const next = window.prompt("Rename sheet", t.title);
                if (next && next.trim() && next.trim() !== t.title) {
                  void tabOp({ op: "rename", sheetId: t.sheetId, title: next.trim() });
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ sheetId: t.sheetId, title: t.title, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                "shrink-0 rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                t.title === activeSheet
                  ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
              )}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {/* Tab context menu (right-click) */}
      {tabMenu && (
        <div
          className="fixed z-50 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ top: tabMenu.y, left: tabMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const next = window.prompt("Rename sheet", tabMenu.title);
              setTabMenu(null);
              if (next && next.trim() && next.trim() !== tabMenu.title) {
                void tabOp({ op: "rename", sheetId: tabMenu.sheetId, title: next.trim() });
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
          >
            Rename
          </button>
          {meta && meta.tabs.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setTabMenu(null);
                if (window.confirm(`Delete sheet "${tabMenu.title}"? This cannot be undone.`)) {
                  void tabOp({ op: "delete", sheetId: tabMenu.sheetId });
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]"
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* Conditional-format dialog */}
      {condFmtOpen && activeTab && (
        <CondFmtDialog
          rangeLabel={`${colToLetter(selRect.c1)}${selRect.r1 + 1}:${colToLetter(selRect.c2)}${selRect.r2 + 1}`}
          onClose={() => setCondFmtOpen(false)}
          onApply={async (ruleType, value, bgColor) => {
            setCondFmtOpen(false);
            await structuralOp({
              op: "condformat",
              startRow: selRect.r1, endRow: selRect.r2,
              startCol: selRect.c1, endCol: selRect.c2,
              ruleType, value, bgColor,
            });
          }}
        />
      )}
    </div>
  );
}

/** Modal to add a single conditional-format rule to the current selection. */
function CondFmtDialog({
  rangeLabel,
  onClose,
  onApply,
}: {
  rangeLabel: string;
  onClose: () => void;
  onApply: (
    ruleType: "NUMBER_GREATER" | "NUMBER_LESS" | "NUMBER_EQ" | "TEXT_CONTAINS",
    value: string,
    bgColor: string
  ) => void;
}) {
  const [ruleType, setRuleType] = useState<"NUMBER_GREATER" | "NUMBER_LESS" | "NUMBER_EQ" | "TEXT_CONTAINS">("NUMBER_GREATER");
  const [value, setValue] = useState("");
  const [bgColor, setBgColor] = useState("#fff2cc");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[var(--color-text)]">Conditional formatting</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
          Applies to <span className="font-medium text-[var(--color-text)]">{rangeLabel}</span>
        </p>
        <label className="mb-1.5 block text-[12px] font-medium text-[var(--color-text-muted)]">Condition</label>
        <select
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as typeof ruleType)}
          className="input-field mb-3 w-full text-[13px]"
        >
          <option value="NUMBER_GREATER">Greater than</option>
          <option value="NUMBER_LESS">Less than</option>
          <option value="NUMBER_EQ">Equal to</option>
          <option value="TEXT_CONTAINS">Text contains</option>
        </select>
        <label className="mb-1.5 block text-[12px] font-medium text-[var(--color-text-muted)]">Value</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={ruleType === "TEXT_CONTAINS" ? "text…" : "number…"}
          className="input-field mb-3 w-full text-[13px]"
        />
        <label className="mb-1.5 block text-[12px] font-medium text-[var(--color-text-muted)]">Fill color</label>
        <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="mb-4 h-9 w-16 cursor-pointer rounded border border-[var(--color-border)]" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-[13px]">Cancel</button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => onApply(ruleType, value.trim(), bgColor)}
            className="btn-primary px-4 py-2 text-[13px] disabled:opacity-50"
          >
            Add rule
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]",
        active && "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-border)]" />;
}
