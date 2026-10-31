/**
 * Fixed-width marketing templates (600-800px tables) overflow a narrower pane,
 * and the email iframe doesn't scroll, so they were clipped on the right.
 * Shrink the document to fit the available width, as Gmail does.
 *
 * Natural width is the widest rendered element, not documentElement.scrollWidth:
 * templates often pin `body { width: Npx; overflow: hidden }`, which hides the
 * overflow from scrollWidth while still clipping it.
 */
export function fitEmailToWidth(doc: Document, available: number): void {
  const body = doc.body;
  if (!body) return;
  body.style.zoom = "";
  if (available <= 0) return;

  const origin = body.getBoundingClientRect().left;
  let natural = doc.documentElement.scrollWidth;
  for (const el of Array.from(body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right - origin > natural) natural = Math.ceil(r.right - origin);
  }

  if (natural > available + 1) body.style.zoom = String(available / natural);
}
