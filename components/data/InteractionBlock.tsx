"use client";

import { useEffect, useState } from "react";
import { dataApi } from "@/lib/data-model/client";

type Info = { available: boolean; contacts?: number; last_interaction_at?: string | null; connection_strength?: string | null; message_count_90d?: number; message_count_total?: number; as_of?: string | null };

/** Read-only figures from mail: last interaction, connection strength, volume. Computed, never edited by hand. */
export function InteractionBlock({ recordId, isCompany }: { recordId: string; isCompany: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let live = true;
    void dataApi<Info>(`/api/data/records/${recordId}/interaction`).then((r) => live && setInfo(r.ok ? r.data : { available: false }));
    return () => {
      live = false;
    };
  }, [recordId]);

  if (!info?.available || !info.contacts) return null;
  const rows: [string, string][] = [
    ["Last interaction", info.last_interaction_at ? new Date(info.last_interaction_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"],
    [isCompany ? "Strongest connection" : "Connection strength", info.connection_strength ?? "—"],
    ["Mail, last 90 days", String(info.message_count_90d ?? 0)],
    ["Mail, all time", String(info.message_count_total ?? 0)],
    ...(isCompany ? ([["People emailed", String(info.contacts)]] as [string, string][]) : []),
  ];
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">From mail</h3>
      <dl className="space-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11.5px] text-[var(--color-text-faint)]">Computed from the contact sync{info.as_of ? `, as of ${new Date(info.as_of).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}. Not editable.</p>
    </div>
  );
}
