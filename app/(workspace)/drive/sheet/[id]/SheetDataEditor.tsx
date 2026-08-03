"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import type { CellBase, DataEditorProps } from "react-spreadsheet";
import { FORMULA_FUNCTION_NAMES, FORMULA_FUNCTION_DESCRIPTIONS } from "./formula-functions";
import { useSheetEditorGrid } from "./SheetEditorGridContext";
import { getDataCellElement, rectFromElement, unionRect, type Rect } from "./sheetEditorDom";

/** Characters after which a fresh formula operand is expected — matches Excel/Sheets
 * "point mode": pressing an arrow key right after one of these starts pointing at a cell
 * instead of moving the text cursor. */
const OPERAND_START_CHARS = new Set(["=", "(", ",", "+", "-", "*", "/", "^", "%", ":", " ", "<", ">"]);
const MAX_SUGGESTIONS = 8;

type Pointer = { anchorRow: number; anchorCol: number; row: number; col: number };
type TokenRange = { start: number; end: number };

function cellRefText(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

/** Single cell -> "C3"; a range built via Shift+Arrow -> "C3:C5". */
function pointerToToken(pointer: Pointer): string {
  const { anchorRow, anchorCol, row, col } = pointer;
  if (anchorRow === row && anchorCol === col) return cellRefText(row, col);
  const startRow = Math.min(anchorRow, row);
  const startCol = Math.min(anchorCol, col);
  const endRow = Math.max(anchorRow, row);
  const endCol = Math.max(anchorCol, col);
  return `${cellRefText(startRow, startCol)}:${cellRefText(endRow, endCol)}`;
}

function getPointerRect(container: HTMLElement | null, pointer: Pointer): Rect | null {
  const startRow = Math.min(pointer.anchorRow, pointer.row);
  const startCol = Math.min(pointer.anchorCol, pointer.col);
  const endRow = Math.max(pointer.anchorRow, pointer.row);
  const endCol = Math.max(pointer.anchorCol, pointer.col);
  const startEl = getDataCellElement(container, startRow, startCol);
  const endEl = getDataCellElement(container, endRow, endCol);
  if (!startEl || !endEl) return null;
  return unionRect(rectFromElement(startEl), rectFromElement(endEl));
}

/** The identifier being typed immediately before the cursor, e.g. value="=SU",
 * cursor=3 -> {token:"SU", start:1}. Only a run of letters counts. */
function currentToken(value: string, cursor: number): { token: string; start: number } {
  let start = cursor;
  while (start > 0 && /[A-Za-z]/.test(value[start - 1])) start--;
  return { token: value.slice(start, cursor), start };
}

export default function SheetDataEditor({ cell, row, column, onChange }: DataEditorProps<CellBase>) {
  const { containerRef, rowCount, colCount } = useSheetEditorGrid();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const value = cell?.value === undefined || cell?.value === null ? "" : String(cell.value);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [tokenRange, setTokenRange] = useState<TokenRange | null>(null);
  const [dropdownRect, setDropdownRect] = useState<Rect | null>(null);

  const [pointer, setPointer] = useState<Pointer | null>(null);
  const pointModeRangeRef = useRef<TokenRange | null>(null);
  const [overlayRect, setOverlayRect] = useState<Rect | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      const len = input.value.length;
      input.focus();
      input.setSelectionRange(len, len);
    }
  }, []);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setTokenRange(null);
    setHighlightIndex(0);
  }, []);

  const commitValue = useCallback(
    (nextValue: string, cursorPos: number) => {
      onChange({ ...(cell ?? { value: "" }), value: nextValue });
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [cell, onChange]
  );

  const updateSuggestions = useCallback(
    (nextValue: string, cursorPos: number) => {
      if (!nextValue.startsWith("=")) {
        closeSuggestions();
        return;
      }
      const { token, start } = currentToken(nextValue, cursorPos);
      if (!token) {
        closeSuggestions();
        return;
      }
      const upper = token.toUpperCase();
      const matches = FORMULA_FUNCTION_NAMES.filter((name) => name.startsWith(upper)).slice(0, MAX_SUGGESTIONS);
      if (matches.length === 0) {
        closeSuggestions();
        return;
      }
      setSuggestions(matches);
      setTokenRange({ start, end: cursorPos });
      setHighlightIndex(0);
    },
    [closeSuggestions]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      const cursorPos = event.target.selectionStart ?? nextValue.length;
      // A direct text edit ends point mode — any reference already inserted
      // stays behind as plain text from here on, same as typing over it in Excel.
      setPointer(null);
      pointModeRangeRef.current = null;
      onChange({ ...(cell ?? { value: "" }), value: nextValue });
      updateSuggestions(nextValue, cursorPos);
    },
    [cell, onChange, updateSuggestions]
  );

  const acceptSuggestion = useCallback(
    (name: string) => {
      if (!tokenRange) return;
      const insertion = `${name}(`;
      const nextValue = value.slice(0, tokenRange.start) + insertion + value.slice(tokenRange.end);
      const cursorPos = tokenRange.start + insertion.length;
      closeSuggestions();
      commitValue(nextValue, cursorPos);
    },
    [tokenRange, value, closeSuggestions, commitValue]
  );

  /** Points at a specific cell (from an arrow-key move or a mouse click/drag)
   * and splices its reference into the formula at the point-mode start
   * position, replacing whatever token the previous point at this session
   * inserted rather than accumulating. `extend` keeps the existing anchor
   * (Shift+Arrow, or continuing a mouse drag) to build a "C3:C5" range. */
  const pointAt = useCallback(
    (targetRow: number, targetCol: number, extend: boolean, cursorPos: number) => {
      const anchor = extend && pointer ? { row: pointer.anchorRow, col: pointer.anchorCol } : { row: targetRow, col: targetCol };
      const next: Pointer = { anchorRow: anchor.row, anchorCol: anchor.col, row: targetRow, col: targetCol };

      const range = pointModeRangeRef.current ?? { start: cursorPos, end: cursorPos };
      const token = pointerToToken(next);
      const nextValue = value.slice(0, range.start) + token + value.slice(range.end);
      pointModeRangeRef.current = { start: range.start, end: range.start + token.length };

      setPointer(next);
      commitValue(nextValue, range.start + token.length);
    },
    [pointer, value, commitValue]
  );

  const movePointer = useCallback(
    (dRow: number, dCol: number, extend: boolean, cursorPos: number) => {
      const base = pointer ?? { anchorRow: row, anchorCol: column, row, col: column };
      const nextRow = Math.min(Math.max(base.row + dRow, 0), Math.max(rowCount - 1, 0));
      const nextCol = Math.min(Math.max(base.col + dCol, 0), Math.max(colCount - 1, 0));
      pointAt(nextRow, nextCol, extend, cursorPos);
    },
    [pointer, row, column, rowCount, colCount, pointAt]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (suggestions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlightIndex((i) => (i + 1) % suggestions.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          acceptSuggestion(suggestions[highlightIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeSuggestions();
          return;
        }
      }

      const isArrow =
        event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (isArrow && value.startsWith("=") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const cursorPos = inputRef.current?.selectionStart ?? value.length;
        const charBefore = value[cursorPos - 1];
        const eligible = pointer !== null || (charBefore !== undefined && OPERAND_START_CHARS.has(charBefore));
        if (eligible) {
          event.preventDefault();
          const dRow = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          const dCol = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          movePointer(dRow, dCol, event.shiftKey, cursorPos);
        }
      }
    },
    [suggestions, highlightIndex, acceptSuggestion, closeSuggestions, value, pointer, movePointer]
  );

  // pointAt() commits a new value on every mouse move during a drag, which
  // would re-render this component and (if referenced directly in the effect
  // below) tear down and rebuild the mousedown/mousemove listeners mid-drag —
  // losing the in-progress "dragging" flag. Refs keep the listeners mounted
  // once for the component's lifetime while still reading fresh values.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const pointAtRef = useRef(pointAt);
  useEffect(() => {
    pointAtRef.current = pointAt;
  }, [pointAt]);

  /**
   * Mouse equivalent of point mode: while a formula is being typed, clicking
   * (or click-dragging) another cell inserts its reference instead of the
   * library's normal click-to-activate-that-cell behavior. Listens on the
   * grid container in the CAPTURE phase so we can intercept and cancel the
   * library's own cell click handling before it commits this edit.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false;

    const findCellAt = (x: number, y: number): { row: number; col: number } | null => {
      const el = document.elementFromPoint(x, y);
      const td = el?.closest("td");
      const tr = td?.parentElement;
      const tbody = tr?.parentElement;
      if (!td || !tr || !tbody) return null;
      const rowIdx = Array.prototype.indexOf.call(tbody.children, tr) - 1; // -1 for header row
      const colIdx = Array.prototype.indexOf.call(tr.children, td) - 1; // -1 for row-indicator cell
      if (rowIdx < 0 || colIdx < 0) return null;
      return { row: rowIdx, col: colIdx };
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!valueRef.current.startsWith("=")) return;
      if (rootRef.current?.contains(e.target as Node)) return; // clicks in our own input are normal
      const target = findCellAt(e.clientX, e.clientY);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      const cursorPos = inputRef.current?.selectionStart ?? valueRef.current.length;
      pointAtRef.current(target.row, target.col, false, cursorPos);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const target = findCellAt(e.clientX, e.clientY);
      if (!target) return;
      const cursorPos = inputRef.current?.selectionStart ?? valueRef.current.length;
      pointAtRef.current(target.row, target.col, true, cursorPos);
    };

    const handleMouseUp = () => {
      dragging = false;
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    if (!pointer) {
      setOverlayRect(null);
      return;
    }
    const recompute = () => setOverlayRect(getPointerRect(containerRef.current, pointer));
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [pointer, containerRef]);

  useLayoutEffect(() => {
    if (suggestions.length === 0 || !rootRef.current) {
      setDropdownRect(null);
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width, height: 0 });
  }, [suggestions]);

  return (
    <div ref={rootRef} className="Spreadsheet__data-editor">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={closeSuggestions}
      />
      {overlayRect
        ? createPortal(
            <div
              className="sheet-editor-point-mode-highlight"
              style={{
                position: "fixed",
                top: overlayRect.top,
                left: overlayRect.left,
                width: overlayRect.width,
                height: overlayRect.height,
              }}
            />,
            document.body
          )
        : null}
      {suggestions.length > 0 && dropdownRect
        ? createPortal(
            <div
              className="sheet-editor-formula-suggestions"
              style={{
                position: "fixed",
                top: dropdownRect.top,
                left: dropdownRect.left,
                minWidth: Math.max(dropdownRect.width, 220),
              }}
            >
              {suggestions.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={
                    i === highlightIndex
                      ? "sheet-editor-formula-suggestion sheet-editor-formula-suggestion--active"
                      : "sheet-editor-formula-suggestion"
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(name);
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                >
                  <span className="sheet-editor-formula-suggestion-name">{name}</span>
                  {FORMULA_FUNCTION_DESCRIPTIONS[name] ? (
                    <span className="sheet-editor-formula-suggestion-desc">{FORMULA_FUNCTION_DESCRIPTIONS[name]}</span>
                  ) : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
