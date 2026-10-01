"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, AlertTriangle, Minus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import type { CampaignReport } from "@/app/api/campaigns/[campaignId]/route";

const METRICS: { key: "opened" | "replied" | "bounced"; label: string; barClass: string }[] = [
  { key: "opened", label: "Opened", barClass: "bg-[var(--color-copper)]" },
  { key: "replied", label: "Responded", barClass: "bg-emerald-500" },
  { key: "bounced", label: "Bounced", barClass: "bg-[var(--color-danger)]" },
];

/** One glance per column, instead of making someone read three true/false cells. */
function StatusIcon({ on, danger }: { on: boolean; danger?: boolean }) {
  if (!on) return <Minus className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />;
  if (danger) return <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-danger)]" />;
  return <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />;
}

export default function CampaignReportPage() {
  const params = useParams<{ campaignId: string }>();
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/campaigns/${encodeURIComponent(params.campaignId)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { error?: string; report?: CampaignReport };
        if (!res.ok) throw new Error(data.error || "Failed to load campaign");
        setReport(data.report ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.campaignId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {titleCase("Back to campaigns")}
      </Link>

      {loading ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
      ) : error ? (
        <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
      ) : report ? (
        <div className="surface-card space-y-6 p-6">
          <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
            {report.campaignName}
          </h1>

          <p className="text-[15px] font-semibold text-[var(--color-text)]">
            {titleCase("Sent")}: {report.sent} {report.sent === 1 ? "email" : "emails"}
          </p>

          <div className="space-y-5">
            {METRICS.map(({ key, label, barClass }) => {
              const count = report[key];
              const pct = report.sent > 0 ? Math.round((count / report.sent) * 100) : 0;
              return (
                <div key={key}>
                  <p className="mb-1.5 text-[14px] font-semibold uppercase tracking-wide text-[var(--color-text)]">
                    {titleCase(label)}: {count}/{report.sent} ({pct}%)
                  </p>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {titleCase("Recipients")}
            </h2>
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                    <th className="px-3 py-2">{titleCase("Recipient")}</th>
                    <th className="px-3 py-2 text-center">{titleCase("Opened")}</th>
                    <th className="px-3 py-2 text-center">{titleCase("Responded")}</th>
                    <th className="px-3 py-2 text-center">{titleCase("Bounced")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recipients.map((r) => (
                    <tr key={r.email} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="min-w-0 px-3 py-2">
                        <span className="block truncate text-[var(--color-text)]">{r.email}</span>
                        <span className="block text-[11px] text-[var(--color-text-faint)]">
                          {formatDate(r.sentAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center" title={r.openedAt ? formatDate(r.openedAt) : undefined}>
                        <StatusIcon on={r.opened} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusIcon on={r.replied} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusIcon on={r.bounced} danger />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[12px] text-[var(--color-text-faint)]">
            {titleCase(
              "Responded and Bounced are checked live against each thread and cached once a recipient's outcome is known — refresh to pick up anything new."
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
