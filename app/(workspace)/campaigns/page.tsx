"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import type { CampaignListItem } from "@/app/api/campaigns/route";

/** One row per mass-send ("campaign") from the inbox composer, newest first. */
export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns", { cache: "no-store" });
        const data = (await res.json()) as { error?: string; campaigns?: CampaignListItem[] };
        if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
        setCampaigns(data.campaigns ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const empty = !loading && campaigns.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
        {titleCase("Campaigns")}
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="skeleton-shimmer h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : empty ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
          {titleCase(
            "No campaigns yet. Send a mail-merge from the inbox composer and its report shows up here."
          )}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {campaigns.map((c) => (
            <li
              key={c.campaignId}
              data-testid={`campaigns-list-item-${c.campaignId}`}
              className="transition-colors hover:bg-[var(--color-surface-offset)]"
            >
              <Link
                href={`/campaigns/${encodeURIComponent(c.campaignId)}`}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                    <Megaphone className="h-[18px] w-[18px]" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                      {c.campaignName}
                    </p>
                    <p className="font-mono mt-0.5 text-[11.5px] text-[var(--color-text-faint)]">
                      {titleCase("Sent")} {formatDate(c.firstSentAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-[13px] font-medium text-[var(--color-text-muted)]">
                  <span>{c.sentCount} {titleCase("sent")}</span>
                  <span>{c.openedCount} {titleCase("opened")}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
