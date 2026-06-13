export type ChartDayPoint = {
  date: string;
  callsIn: number;
  callsOut: number;
  messages: number;
  tokens: number;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Max bars before we aggregate; keeps labels readable on 90d / all-time. */
const MAX_CHART_BARS = 28;

function normalizeIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}-\d{2}$/.test(s)) return `2000-${s}`;
  return null;
}

function formatSingleDate(raw: string): string {
  const iso = normalizeIsoDate(raw);
  if (!iso) return raw;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatRangeLabel(start: string, end: string): string {
  const sIso = normalizeIsoDate(start);
  const eIso = normalizeIsoDate(end);
  if (!sIso || !eIso) return `${start}–${end}`;
  const s = new Date(`${sIso}T00:00:00.000Z`);
  const e = new Date(`${eIso}T00:00:00.000Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start}–${end}`;
  const sMonth = MONTHS_SHORT[s.getUTCMonth()];
  const eMonth = MONTHS_SHORT[e.getUTCMonth()];
  const sDay = s.getUTCDate();
  const eDay = e.getUTCDate();
  if (sMonth === eMonth) return `${sMonth} ${sDay}–${eDay}`;
  return `${sMonth} ${sDay}–${eMonth} ${eDay}`;
}

/** Compact x-axis label — never emit raw YYYY-MM-DD ranges. */
export function formatChartXLabel(date: string): string {
  if (date.includes("–")) {
    const [start, end] = date.split("–").map((p) => p.trim());
    return formatRangeLabel(start, end);
  }
  return formatSingleDate(date);
}

/**
 * Which bar indices should show an x label (always first + last, evenly spaced).
 * Targets ~6 labels on wide charts, fewer when bars are already weekly buckets.
 */
export function getChartLabelIndices(barCount: number, maxLabels = 6): Set<number> {
  if (barCount <= 0) return new Set();
  if (barCount <= maxLabels) return new Set(Array.from({ length: barCount }, (_, i) => i));

  const target = Math.min(maxLabels, Math.max(4, Math.floor(520 / 72)));
  const indices = new Set<number>([0, barCount - 1]);
  const slots = target - 2;
  for (let k = 1; k <= slots; k++) {
    indices.add(Math.round((k * (barCount - 1)) / (slots + 1)));
  }
  return indices;
}

/** @deprecated Use getChartLabelIndices */
export function chartLabelStep(barCount: number): number {
  const indices = getChartLabelIndices(barCount);
  if (indices.size <= 1) return 1;
  const sorted = Array.from(indices).sort((a, b) => a - b);
  let minGap = barCount;
  for (let i = 1; i < sorted.length; i++) {
    minGap = Math.min(minGap, sorted[i]! - sorted[i - 1]!);
  }
  return Math.max(1, minGap);
}

function aggregateChunk(chunk: ChartDayPoint[]): ChartDayPoint {
  const first = chunk[0]!;
  const last = chunk[chunk.length - 1]!;
  const startIso = first.date.slice(0, 10);
  const endIso = last.date.slice(0, 10);
  return {
    date: startIso === endIso ? startIso : `${startIso}–${endIso}`,
    callsIn: chunk.reduce((n, d) => n + d.callsIn, 0),
    callsOut: chunk.reduce((n, d) => n + d.callsOut, 0),
    messages: chunk.reduce((n, d) => n + d.messages, 0),
    tokens: chunk.reduce((n, d) => n + d.tokens, 0),
  };
}

/** Bucket daily series: daily ≤21d, every 3d ~45d, weekly ~90d, dynamic beyond. */
export function bucketSeriesForChart(series: ChartDayPoint[], maxBars = MAX_CHART_BARS): ChartDayPoint[] {
  const n = series.length;
  if (n <= 21) return series;

  let chunkSize: number;
  if (n <= 45) chunkSize = 3;
  else if (n <= 90) chunkSize = 7;
  else chunkSize = Math.max(7, Math.ceil(n / maxBars));

  const out: ChartDayPoint[] = [];
  for (let i = 0; i < n; i += chunkSize) {
    out.push(aggregateChunk(series.slice(i, i + chunkSize)));
  }
  return out;
}

/** Extra bottom padding when labels are dense or rotated. */
export function chartBottomPadding(barCount: number): number {
  if (barCount <= 14) return 28;
  if (barCount <= 24) return 32;
  return 36;
}

export function shouldRotateChartLabels(barCount: number): boolean {
  return barCount > 14 && barCount <= 24;
}
