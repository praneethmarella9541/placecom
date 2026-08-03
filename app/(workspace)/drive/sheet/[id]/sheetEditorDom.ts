export type Rect = { top: number; left: number; width: number; height: number };

/**
 * Grid DOM is a plain <table><tbody>: row 0 is the header row, then one <tr>
 * per data row; each row's first cell is the row-indicator, so both axes are
 * offset by 1. This relies on react-spreadsheet's current rendering
 * structure (no public API exposes arbitrary cell positions) — a deliberate,
 * disclosed trade-off for the point-mode highlight and fill-handle overlays.
 */
export function getDataCellElement(container: HTMLElement | null, row: number, col: number): HTMLElement | null {
  const tbody = container?.querySelector("table tbody");
  const tr = tbody?.children[row + 1] as HTMLElement | undefined;
  const td = tr?.children[col + 1] as HTMLElement | undefined;
  return td ?? null;
}

export function rectFromElement(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { top, left, width: right - left, height: bottom - top };
}
