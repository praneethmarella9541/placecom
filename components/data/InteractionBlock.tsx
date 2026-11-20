"use client";

import { useEffect, useState } from "react";
import { dataApi } from "@/lib/data-model/client";
import { useModuleVisibility } from "@/lib/module-visibility";

type Source = "all" | "common" | "byom" | "mine";
type Info = {
  available: boolean;
  contacts?: number;
  source?: Source;
  /** Present only with BYOM on: the mailboxes this viewer can look at separately. */
  options?: Source[];
  last_interaction_at?: string | null;
  connection_strength?: string | null;
  message_count_90d?: number;
  message_count_total?: number;
  as_of?: string | null;
};

const SOURCE_LABEL: Record<Source, string> = {
  all: "All mailboxes",
  common: "Common mailbox",
  byom: "BYOM mailboxes",
  mine: "My mailbox",
};

/**
 * Read-only figures from mail: last interaction, connection strength, volume. Computed, never
 * edited by hand. With BYOM on, a menu narrows them to one kind of mailbox; the merged contact stays
 * one record, this only changes which mailbox's figures are shown.
 */
export function InteractionBlock({ recordId, isCompany }: { recordId: string; isCompany: boolean }) {
  const byomVisible = useModuleVisibility().isVisible("byom");
  const [source, setSource] = useState<Source>("all");
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);

  // A different record starts from the merged view again.
  useEffect(() => setSource("all"), [recordId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const qs = byomVisible && source !== "all" ? `?source=${source}` : "";
    void dataApi<Info>(`/api/data/records/${recordId}/interaction${qs}`).then((r) => {
      if (!live) return;
      setInfo(r.ok ? r.data : { available: false });
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [recordId, source, byomVisible]);

  // Nothing at all from mail for this record: no block (and nothing to filter).
  if (!info?.available) return null;
  if (source === "all" && !info.contacts) return null;

  const empty = !info.contacts;
  const rows: [string, string][] = [
    ["Last interaction", info.last_interaction_at ? new Date(info.last_interaction_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"],
    [isCompany ? "Strongest connection" : "Connection strength", info.connection_strength ?? "—"],
    ["Mail, last 90 days", String(info.message_count_90d ?? 0)],
    ["Mail, all time", String(info.message_count_total ?? 0)],
    ...(isCompany ? ([["People emailed", String(info.contacts ?? 0)]] as [string, string][]) : []),
  ];
  const options = byomVisible ? info.options : undefined;
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">From mail</h3>
        {options && (
          <select
            aria-label="Show mail figures for"
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] font-medium text-[var(--color-text)]"
          >
            {options.map((o) => (
              <option key={o} value={o}>{SOURCE_LABEL[o]}</option>
            ))}
          </select>
        )}
      </div>
      {empty ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {source === "mine" ? "You haven't had mail with them in your own mailbox." : `No mail with them in ${SOURCE_LABEL[source].toLowerCase()}.`}
        </p>
      ) : (
        <dl className={`space-y-1 text-[13px] ${loading ? "opacity-60" : ""}`}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-muted)]">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-[11.5px] text-[var(--color-text-faint)]">
        Computed from the contact sync{info.as_of ? `, as of ${new Date(info.as_of).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}.
        {source === "byom" ? " Members' mailboxes are combined, not named." : ""} Not editable.
      </p>
    </div>
  );
}
