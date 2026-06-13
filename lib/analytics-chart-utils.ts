export type ChartDayPoint = {
  date: string;
  callsIn: number;
  callsOut: number;
  messages: number;
  tokens: number;
};

const MAX_CHART_BARS = 48;

/** How many bar indices to skip between x-axis labels. */
export function chartLabelStep(barCount: number): number {
  if (barCount <= 14) return 1;
  if (barCount <= 31) return 2;
  if (barCount <= 60) return 4;
  return Math.max(1, Math.ceil(barCount / 10));
}

/** Bucket long daily series so bars stay readable. */
export function bucketSeriesForChart(series: ChartDayPoint[], maxBars = MAX_CHART_BARS): ChartDayPoint[] {
  if (series.length <= maxBars) return series;
  const size = Math.ceil(series.length / maxBars);
  const out: ChartDayPoint[] = [];
  for (let i = 0; i < series.length; i += size) {
    const chunk = series.slice(i, i + size);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    out.push({
      date: first.date === last.date ? first.date : `${first.date.slice(5)}–${last.date.slice(5)}`,
      callsIn: chunk.reduce((n, d) => n + d.callsIn, 0),
      callsOut: chunk.reduce((n, d) => n + d.callsOut, 0),
      messages: chunk.reduce((n, d) => n + d.messages, 0),
      tokens: chunk.reduce((n, d) => n + d.tokens, 0),
    });
  }
  return out;
}

export function formatChartXLabel(date: string, barCount: number): string {
  if (date.includes("–")) return date;
  if (barCount > 120) return date.slice(0, 7);
  return date.slice(5);
}
