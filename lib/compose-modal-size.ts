/**
 * Size of the centered compose window, shared with the mail templates modal so
 * the two read as the same surface — a template is written at the width it
 * will be sent at, and switching between them doesn't jump.
 */
export const COMPOSE_MODAL_SIZE = {
  width: 1000,
  maxWidth: "calc(100vw - 48px)",
  height: "min(720px, calc(100vh - 96px))",
} as const;

/**
 * The same size as CSS variables, so it only applies from `lg` up: on a phone an inline width and
 * max-width would beat the full-bleed classes and leave the window short of the screen's edge.
 * Pair `composeSizeVars()` (style) with `COMPOSE_SIZE_CLASS` (className).
 */
export const COMPOSE_SIZE_CLASS =
  "w-full max-w-none h-[92dvh] lg:h-[var(--cm-h)] lg:w-[var(--cm-w)] lg:max-w-[var(--cm-max)]";

export function composeSizeVars(size: { width: number | string; maxWidth: string; height: number | string }): Record<string, string> {
  const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  return { "--cm-w": px(size.width), "--cm-max": size.maxWidth, "--cm-h": px(size.height) };
}
