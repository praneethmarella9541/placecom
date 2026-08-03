"use client";

import type { CellBase, DataViewerProps } from "react-spreadsheet";
import { useSheetEditorGrid } from "./SheetEditorGridContext";

/** Same rendering as react-spreadsheet's default DataViewer, plus a purely
 * presentational search-match highlight read from context — never mutates
 * cell data, so search can't interfere with editing/saving. */
export default function SheetDataViewer({ cell, evaluatedCell, row, column }: DataViewerProps<CellBase>) {
  const { searchMatches, currentMatchKey } = useSheetEditorGrid();
  const key = `${row}:${column}`;
  const isMatch = searchMatches.has(key);
  const isCurrent = key === currentMatchKey;

  const raw = evaluatedCell?.value ?? cell?.value;
  const display =
    typeof raw === "boolean" ? (raw ? "TRUE" : "FALSE") : raw === undefined || raw === null ? "" : String(raw);

  const className = [
    "Spreadsheet__data-viewer",
    isMatch ? "sheet-editor-search-match" : "",
    isCurrent ? "sheet-editor-search-match--current" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={className}>{display}</span>;
}
