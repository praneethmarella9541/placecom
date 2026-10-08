/**
 * Inbox list load timing — how long a tab/folder switch or a search takes to
 * show rows. Each load records two numbers, measured from when the list load
 * starts (the tab/folder state has just changed):
 *
 *   firstPaintMs  rows are on screen (cached rows, or streamed placeholders)
 *   completeMs    the final, fully-populated list is in place
 *
 * and a `source`: "cache" (painted from the session cache) or "network" (cold).
 *
 * Where to read it:
 *   - PostHog event `mail_list_loaded` (view kind only — never the search text)
 *   - browser console: `[mail-perf] …` per load, and `__mailPerf.summary()` for
 *     median / p90 per kind+source over this tab's last loads
 *
 * Compare `network` firstPaintMs/completeMs across deploys to see whether
 * cold tab switches and searches got faster.
 */

import posthog from "posthog-js";

export type MailPerfKind = "tab" | "search";
export type MailPerfSource = "cache" | "network";

export type MailPerfSample = {
  kind: MailPerfKind;
  view: string;
  source: MailPerfSource;
  firstPaintMs: number;
  completeMs: number;
  rows: number;
  at: number;
};

type Active = {
  id: number;
  kind: MailPerfKind;
  view: string;
  t0: number;
  firstPaintMs?: number;
  source?: MailPerfSource;
};

const MAX_SAMPLES = 200;
const samples: MailPerfSample[] = [];
let active: Active | null = null;
let nextId = 1;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Start timing a list load. A load that never completes (superseded) is simply dropped. */
export function mailPerfBegin(kind: MailPerfKind, view: string): number {
  const id = nextId++;
  active = { id, kind, view, t0: now() };
  return id;
}

/** Rows are on screen. Only the first call per load counts. */
export function mailPerfFirstPaint(id: number, source: MailPerfSource): void {
  if (!active || active.id !== id || active.firstPaintMs !== undefined) return;
  active.firstPaintMs = Math.round(now() - active.t0);
  active.source = source;
}

/** The final list is in place — records the sample. */
export function mailPerfComplete(id: number, rows: number): void {
  if (!active || active.id !== id) return;
  const a = active;
  active = null;
  const completeMs = Math.round(now() - a.t0);
  const sample: MailPerfSample = {
    kind: a.kind,
    view: a.view,
    source: a.source ?? "network",
    firstPaintMs: a.firstPaintMs ?? completeMs,
    completeMs,
    rows,
    at: Date.now(),
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();

  console.log(
    `[mail-perf] ${sample.kind} ${sample.source} view=${sample.view} ` +
      `firstPaint=${sample.firstPaintMs}ms complete=${sample.completeMs}ms rows=${rows}`
  );
  try {
    posthog.capture("mail_list_loaded", {
      kind: sample.kind,
      // The folder/label part only — a search view key ends with the query text.
      view: sample.kind === "search" ? "search" : sample.view,
      source: sample.source,
      first_paint_ms: sample.firstPaintMs,
      complete_ms: sample.completeMs,
      rows,
    });
  } catch {
    /* analytics must never affect the inbox */
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Median / p90 per kind+source over the recorded loads. */
export function mailPerfSummary(): Record<
  string,
  { n: number; firstPaintP50: number; firstPaintP90: number; completeP50: number; completeP90: number }
> {
  const groups = new Map<string, MailPerfSample[]>();
  for (const s of samples) {
    const k = `${s.kind}/${s.source}`;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const out: ReturnType<typeof mailPerfSummary> = {};
  for (const [k, g] of Array.from(groups)) {
    const fp = g.map((s) => s.firstPaintMs).sort((a, b) => a - b);
    const cp = g.map((s) => s.completeMs).sort((a, b) => a - b);
    out[k] = {
      n: g.length,
      firstPaintP50: percentile(fp, 50),
      firstPaintP90: percentile(fp, 90),
      completeP50: percentile(cp, 50),
      completeP90: percentile(cp, 90),
    };
  }
  return out;
}

if (typeof window !== "undefined") {
  (window as unknown as { __mailPerf?: unknown }).__mailPerf = {
    samples: () => samples.slice(),
    summary: mailPerfSummary,
  };
}
