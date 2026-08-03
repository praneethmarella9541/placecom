"use client";

import { createContext, useContext, type RefObject } from "react";

/**
 * react-spreadsheet's DataEditor prop contract only passes {cell, row, column,
 * onChange, exitEditMode} — no way to hand a custom editor extra data directly.
 * This context is how SheetDataEditor gets the grid's DOM container (to locate
 * arbitrary cells for the point-mode highlight overlay) and current bounds (to
 * clamp point-mode navigation to the rendered range).
 */
export type SheetEditorGridInfo = {
  containerRef: RefObject<HTMLDivElement>;
  rowCount: number;
  colCount: number;
  /** "row:col" keys of cells matching the active search query — read by
   * SheetDataViewer purely for presentational highlighting. Kept separate
   * from the grid's actual data so search never touches edit/save state. */
  searchMatches: Set<string>;
  currentMatchKey: string | null;
};

export const SheetEditorGridContext = createContext<SheetEditorGridInfo | null>(null);

export function useSheetEditorGrid(): SheetEditorGridInfo {
  const ctx = useContext(SheetEditorGridContext);
  if (!ctx) {
    throw new Error("useSheetEditorGrid must be used within a SheetEditorGridContext.Provider");
  }
  return ctx;
}
