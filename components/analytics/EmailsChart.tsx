"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bucketPoints, niceTicks, type Bucket, type DayPoint } from "@/lib/analytics-chart";
import { cn } from "@/lib/utils";

const HEIGHT = 260;
const MARGIN = { top: 22, right: 8, bottom: 26, left: 36 };
/** Bars never get thicker than this, however few there are; the rest of the slot is air. */
const MAX_BAR = 24;
/** Surface-coloured gap between touching marks (stacked segments, neighbouring bars). */
const GAP = 2;
const RADIUS = 4;
/** Tooltip width (13rem) and its distance from the hovered column. */
const TIP_W = 208;
const TIP_GAP = 12;

/**
 * A column stacks what became of a period's emails, bottom to top. Colours are
 * chosen by meaning from the validated categorical set (see .viz-emails in
 * globals.css): opened is the "good" aqua, responded blue, bounced the warning
 * orange.
 */
const SEGMENTS = [
  { key: "opened", label: "Opened", color: "var(--viz-opened)" },
  { key: "replied", label: "Responded", color: "var(--viz-replied)" },
  { key: "bounced", label: "Bounced", color: "var(--viz-bounced)" },
] as const;

/** A segment is never drawn thinner than this, so rare bounces stay visible. */
const MIN_SEGMENT_PX = 4;

/** A column's height: its opens, responses and bounces added together. */
function stackTotal(b: { opened: number; replied: number; bounced: number }): number {
  return b.opened + b.replied + b.bounced;
}

/** A bar segment with its data-end (top) rounded and its baseline end square. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function unitNoun(unit: "day" | "week" | "month"): string {
  return unit === "day" ? "Daily" : unit === "week" ? "Weekly" : "Monthly";
}

/** An average can be fractional ("1.5"); counts elsewhere are whole. */
function fmtAvg(n: number | undefined): string {
  return (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function plural(n: number, one: string): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : `${one}s`}`;
}

/**
 * Opened, responded and bounced over time: one stacked column per day, week or
 * month depending on the range, so the chart stays one width and readable
 * whatever the range is. A column's height is the three added together, not the
 * number sent: an opened email that is also replied to counts in both, and a
 * reply counts on the day it arrives. The tooltip and the table view give the
 * number sent alongside.
 */
export function EmailsChart({
  points,
  loading = false,
  scopeLabel = "from the whole team",
  reference,
}: {
  points: DayPoint[];
  /** A reload is in flight: keep the previous chart on screen, dimmed, so the page doesn't jump. */
  loading?: boolean;
  /** Finishes the subtitle: "Daily · 90 emails <scopeLabel>". */
  scopeLabel?: string;
  /** An optional comparison line over the bars, e.g. the team average. Same days as `points`; drawn at the same opened + responded + bounced total as a column. */
  reference?: { label: string; points: DayPoint[] };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [asTable]);

  const { unit, buckets } = useMemo(() => bucketPoints(points, { dayMax: 45, weekMax: 270 }), [points]);
  // The reference line only draws when it lines up bar for bar with the data.
  const refValues = useMemo(() => {
    if (!reference || reference.points.length !== points.length) return null;
    const refBuckets = bucketPoints(reference.points, { dayMax: 45, weekMax: 270 }).buckets;
    return refBuckets.length === buckets.length ? refBuckets.map(stackTotal) : null;
  }, [reference, points.length, buckets.length]);
  const grandTotal = useMemo(() => buckets.reduce((n, b) => n + b.sent, 0), [buckets]);
  const totals = useMemo(
    () => ({
      opened: buckets.reduce((n, b) => n + b.opened, 0),
      replied: buckets.reduce((n, b) => n + b.replied, 0),
      bounced: buckets.reduce((n, b) => n + b.bounced, 0),
    }),
    [buckets]
  );
  const activityTotal = totals.opened + totals.replied + totals.bounced;
  const peak = useMemo(() => buckets.reduce((best, b, i) => (stackTotal(b) > stackTotal(buckets[best] ?? b) ? i : best), 0), [buckets]);
  // A floor of 4 so one or two events don't draw a bar that spans the whole height.
  const ticks = useMemo(() => niceTicks(Math.max(4, ...buckets.map(stackTotal), ...(refValues ?? []))), [buckets, refValues]);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const yMax = ticks[ticks.length - 1];
  const band = buckets.length ? innerW / buckets.length : 0;
  const barW = Math.max(2, Math.min(MAX_BAR, band - GAP * 2));
  const y = (v: number) => MARGIN.top + innerH - (v / yMax) * innerH;
  // Thin the x labels to what fits (~64px each) so they never collide.
  const labelEvery = Math.max(1, Math.ceil(64 / Math.max(band, 1)));

  const hovered: Bucket | null = hover !== null ? (buckets[hover] ?? null) : null;
  const hoverCenter = hover !== null ? MARGIN.left + band * hover + band / 2 : 0;
  // Beside the hovered column, never over it: to its right, or its left when there's no room.
  const barEdge = barW / 2;
  const tipFlips = hoverCenter + barEdge + TIP_GAP + TIP_W > width - 4;
  const tipLeft = Math.max(4, tipFlips ? hoverCenter - barEdge - TIP_GAP - TIP_W : hoverCenter + barEdge + TIP_GAP);

  return (
    <section
      className="viz-emails surface-card rounded-2xl p-5"
      aria-label="Email activity over time"
      data-testid="analytics-emails-chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">Email activity over time</h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
            {unitNoun(unit)} · {plural(grandTotal, "email")} {scopeLabel}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
            {SEGMENTS.map((seg) => (
              <li key={seg.key} className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)]">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seg.color }} />
                {seg.label}
                <span className="font-semibold tabular-nums text-[var(--color-text)]">{totals[seg.key].toLocaleString("en-IN")}</span>
              </li>
            ))}
            {refValues && reference && (
              <li className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)]">
                <span aria-hidden className="inline-block h-[3px] w-3 rounded-full bg-[var(--color-text-faint)]" />
                {reference.label}
              </li>
            )}
          </ul>
          <button
            type="button"
            data-testid="analytics-chart-table-toggle"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)]"
          >
            {asTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      <div className={cn("mt-4 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
        {asTable ? (
          <div className="max-h-[240px] overflow-auto rounded-xl border border-[var(--color-border)]">
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--color-surface-offset)] text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  {SEGMENTS.map((o) => (
                    <th key={o.key} className="px-3 py-2 text-right">{o.label}</th>
                  ))}
                  {refValues && reference && <th className="px-3 py-2 text-right">{reference.label}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] tabular-nums">
                {buckets.map((b, i) => (
                  <tr key={b.key}>
                    <td className="px-3 py-1.5 text-[var(--color-text)]">{b.rangeLabel}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-[var(--color-text)]">{b.sent.toLocaleString("en-IN")}</td>
                    {SEGMENTS.map((o) => (
                      <td key={o.key} className="px-3 py-1.5 text-right text-[var(--color-text-muted)]">{b[o.key].toLocaleString("en-IN")}</td>
                    ))}
                    {refValues && <td className="px-3 py-1.5 text-right text-[var(--color-text-muted)]">{fmtAvg(refValues[i])}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={wrapRef} className="relative" style={{ height: HEIGHT }} onPointerLeave={() => setHover(null)}>
            {grandTotal === 0 || activityTotal === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-[14px] font-semibold text-[var(--color-text)]">
                  {grandTotal === 0 ? "No emails sent in this range" : "No opens, responses or bounces in this range yet"}
                </p>
                <p className="mt-1 text-[12.5px] text-[var(--color-text-muted)]">
                  {grandTotal === 0 ? "Try a longer range, or All time." : "Show table lists the emails sent per period."}
                </p>
              </div>
            ) : (
              width > 0 && (
                <svg width={width} height={HEIGHT} role="img" aria-label={`Stacked column chart, ${unitNoun(unit).toLowerCase()} opened, responded and bounced, from ${grandTotal} emails sent`}>
                  {/* Gridlines and y ticks: hairline, solid, recessive. */}
                  {ticks.map((t) => (
                    <g key={t}>
                      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
                      <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-text-faint)">
                        {t.toLocaleString("en-IN")}
                      </text>
                    </g>
                  ))}

                  {/* A soft band behind the hovered period, so the target reads as a whole column. */}
                  {hover !== null && (
                    <rect
                      x={MARGIN.left + band * hover}
                      y={MARGIN.top}
                      width={band}
                      height={innerH}
                      rx={6}
                      fill="var(--color-surface-offset)"
                      opacity={0.7}
                      pointerEvents="none"
                    />
                  )}

                  {buckets.map((b, i) => {
                    const x = MARGIN.left + band * i + (band - barW) / 2;
                    const dim = hover !== null && hover !== i;
                    return (
                      <g key={b.key} opacity={dim ? 0.6 : 1} style={{ transition: "opacity 0.12s" }}>
                        {(() => {
                          // Stack from the baseline up; only the top segment is rounded, and each
                          // segment below it gives up GAP at its top edge so a surface-coloured
                          // line separates them. A segment is never thinner than MIN_SEGMENT_PX,
                          // so a rare bounce stays visible.
                          const parts = SEGMENTS.filter((seg) => b[seg.key] > 0);
                          let yBottom = y(0);
                          return parts.map((seg, idx) => {
                            const h = Math.max(MIN_SEGMENT_PX, (b[seg.key] / yMax) * innerH);
                            const yTop = yBottom - h;
                            const drawn =
                              idx === parts.length - 1 ? (
                                <path key={seg.key} d={topRoundedRect(x, yTop, barW, h, RADIUS)} fill={seg.color} />
                              ) : (
                                <rect key={seg.key} x={x} y={yTop + GAP} width={barW} height={Math.max(1, h - GAP)} fill={seg.color} />
                              );
                            yBottom = yTop;
                            return drawn;
                          });
                        })()}
                      </g>
                    );
                  })}

                  {/* Reference line: 2px neutral, no markers, so it never reads as a series. */}
                  {refValues && (
                    <polyline
                      points={refValues.map((v, i) => `${MARGIN.left + band * i + band / 2},${y(v)}`).join(" ")}
                      fill="none"
                      stroke="var(--color-text-faint)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  )}

                  {/* One selective direct label: the peak. */}
                  {buckets[peak] && stackTotal(buckets[peak]) > 0 && (
                    <text
                      x={MARGIN.left + band * peak + band / 2}
                      y={y(stackTotal(buckets[peak])) - 6}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--color-text-muted)"
                    >
                      {stackTotal(buckets[peak]).toLocaleString("en-IN")}
                    </text>
                  )}

                  {/* X labels, thinned. */}
                  {buckets.map((b, i) =>
                    i % labelEvery === 0 ? (
                      <text
                        key={b.key}
                        x={MARGIN.left + band * i + band / 2}
                        y={HEIGHT - 8}
                        textAnchor="middle"
                        fontSize={11}
                        fill="var(--color-text-faint)"
                      >
                        {b.label}
                      </text>
                    ) : null
                  )}

                  {/* Hit targets: each slot's full height, much bigger than the bar. */}
                  {buckets.map((b, i) => (
                    <rect
                      key={`hit-${b.key}`}
                      x={MARGIN.left + band * i}
                      y={MARGIN.top}
                      width={band}
                      height={innerH}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${b.rangeLabel}: ${b.opened} opened, ${b.replied} responded, ${b.bounced} bounced, from ${b.sent} sent`}
                      onPointerMove={() => setHover(i)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      style={{ outline: "none", cursor: "default" }}
                    />
                  ))}
                </svg>
              )
            )}

            {hovered && grandTotal > 0 && (
              <div
                role="status"
                className="pointer-events-none absolute z-10 w-[13rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
                style={{ left: tipLeft, top: 0 }}
              >
                <p className="text-[12px] font-semibold text-[var(--color-text)]">{hovered.rangeLabel}</p>
                <ul className="mt-1.5 space-y-1">
                  {SEGMENTS.map((seg) => (
                    <li key={seg.key} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seg.color }} />
                        {seg.label}
                      </span>
                      <span className="font-bold tabular-nums text-[var(--color-text)]">{hovered[seg.key].toLocaleString("en-IN")}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-1 text-[12px]">
                    <span className="text-[var(--color-text-muted)]">Emails sent</span>
                    <span className="font-semibold tabular-nums text-[var(--color-text)]">{hovered.sent.toLocaleString("en-IN")}</span>
                  </li>
                  {refValues && reference && hover !== null && (
                    <li className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-1 text-[12px]">
                      <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                        <span aria-hidden className="inline-block h-[3px] w-3 rounded-full bg-[var(--color-text-faint)]" />
                        {reference.label}
                      </span>
                      <span className="font-semibold tabular-nums text-[var(--color-text)]">{fmtAvg(refValues[hover])}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
