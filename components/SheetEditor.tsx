"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  Plus, Trash2, Snowflake, RefreshCw, Loader2,
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
type SheetData = {
  title: string;
  cells: SheetCell[][];
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
};

type Pos = { row: number; col: number };

const COL_W = 120;
const ROW_H = 28;
const HEADER_H = 24;
const ROWNUM_W = 48;

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

  const commitEdit = useCallback(
    async (move?: Pos) => {
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

      // Optimistic display update.
      setData((d) => {
        if (!d) return d;
        const cells = d.cells.map((r) => r.slice());
        cells[pos.row] = cells[pos.row] ? cells[pos.row].slice() : [];
        cells[pos.row][pos.col] = { ...prev, raw: value, display: value };
        return { ...d, cells };
      });

      setSaving(true);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/data`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheet: activeSheet, row: pos.row, col: pos.col, value }),
        });
        const j = (await res.json()) as { ok?: boolean; values?: string[][]; error?: string };
        if (!res.ok) throw new Error(j.error || "Save failed");
        // Refresh displayed (computed) values so formulas recalc.
        if (j.values) {
          setData((d) => {
            if (!d) return d;
            const cells = d.cells.map((r) => r.slice());
            for (let r = 0; r < d.rowCount; r++) {
              for (let c = 0; c < d.columnCount; c++) {
                const display = j.values?.[r]?.[c] ?? "";
                const existing = cells[r]?.[c] ?? { display: "", raw: "" };
                if (cells[r]) cells[r][c] = { ...existing, display };
              }
            }
            return { ...d, cells };
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        void loadSheet(activeSheet); // resync on failure
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, editValue, activeSheet, spreadsheetId, data]
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

  /** Clear all values in the current selection rectangle. */
  const clearSelection = useCallback(async () => {
    if (!activeSheet) return;
    const { r1, r2, c1, c2 } = selRect;
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
  }, [activeSheet, selRect, spreadsheetId, applyValuesRefresh, loadSheet]);

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
    async (startRow: number, startCol: number, values: string[][]) => {
      if (!activeSheet || !values.length) return;
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
    [activeSheet, spreadsheetId, applyValuesRefresh, loadSheet]
  );

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
    [editing, data, selected, beginEdit, copySelection, clearSelection, pasteClipboard, extendTo, selectCell]
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

  const selCell = data ? cellAt(selected.row, selected.col) : null;

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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
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

        {/* Number formats */}
        <button type="button" title="Currency" onClick={() => applyFormat({ numberFormat: { type: "CURRENCY", pattern: "\"$\"#,##0.00" } })} className="flex h-8 w-8 items-center justify-center rounded text-[13px] hover:bg-[var(--color-surface-offset)]">$</button>
        <button type="button" title="Percent" onClick={() => applyFormat({ numberFormat: { type: "PERCENT", pattern: "0.00%" } })} className="flex h-8 w-8 items-center justify-center rounded text-[13px] hover:bg-[var(--color-surface-offset)]">%</button>

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
                className={cn(
                  "flex shrink-0 items-center justify-center border-b border-r border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text-muted)]",
                  selected.col === c && "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                )}
                style={{ width: COL_W, height: HEADER_H }}
              >
                {colToLetter(c)}
              </div>
            ))}
          </div>

          {/* Rows */}
          {Array.from({ length: data.rowCount }).map((_, r) => {
            const frozen = r < data.frozenRowCount;
            return (
              <div key={r} className={cn("flex", frozen && "sticky z-10 bg-[var(--color-surface)]")} style={frozen ? { top: HEADER_H + r * ROW_H } : undefined}>
                {/* Row number */}
                <div
                  className={cn(
                    "sticky left-0 z-10 flex shrink-0 items-center justify-center border-b border-r border-[var(--color-border)] bg-[var(--color-surface-offset)] text-[11px] text-[var(--color-text-muted)]",
                    selected.row === r && "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                  )}
                  style={{ width: ROWNUM_W, height: ROW_H }}
                >
                  {r + 1}
                </div>
                {/* Cells */}
                {Array.from({ length: data.columnCount }).map((_, c) => {
                  const cell = cellAt(r, c);
                  const isFocus = selected.row === r && selected.col === c;
                  const isSel = inSelection(r, c);
                  const isRange = isSel && !(selRect.r1 === selRect.r2 && selRect.c1 === selRect.c2);
                  const isEdit = editing?.row === r && editing?.col === c;
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
                        if (draggingRef.current) extendTo({ row: r, col: c });
                      }}
                      onDoubleClick={() => beginEdit({ row: r, col: c })}
                      className={cn(
                        "relative shrink-0 cursor-cell overflow-hidden border-b border-r border-[var(--color-border)] px-1.5 text-[13px] leading-[26px] text-[var(--color-text)]",
                        isFocus && !isEdit && "ring-2 ring-inset ring-[var(--color-primary)]"
                      )}
                      style={{
                        width: COL_W,
                        height: ROW_H,
                        fontWeight: cell.bold ? 700 : undefined,
                        fontStyle: cell.italic ? "italic" : undefined,
                        textDecoration: [
                          cell.underline ? "underline" : "",
                          cell.strikethrough ? "line-through" : "",
                        ].filter(Boolean).join(" ") || undefined,
                        color: cell.textColor || undefined,
                        backgroundColor: cell.bgColor || undefined,
                        textAlign: (cell.align?.toLowerCase() as "left" | "center" | "right") || "left",
                      }}
                    >
                      {isRange && (
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
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab bar */}
      {meta && meta.tabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-2 py-1">
          {meta.tabs.map((t) => (
            <button
              key={t.sheetId}
              type="button"
              onClick={() => { if (t.title !== activeSheet) void loadSheet(t.title); }}
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
    </div>
  );
}

function ToolBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]",
        active && "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-border)]" />;
}
