"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Paperclip } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";

type Thread = { id: string; subject: string; snippet: string; at: string; hasAttachments: boolean };

/** Mail with this person or company, read live from the mailbox you are working in. Nothing is stored. */
export function EmailsTab({ recordId }: { recordId: string }) {
  const [items, setItems] = useState<Thread[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void dataApi<{ items: Thread[]; reason?: string }>(`/api/data/records/${recordId}/emails`).then((r) => {
      if (!live) return;
      if (r.ok) {
        setItems(r.data.items);
        setReason(r.data.reason ?? null);
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [recordId]);

  if (error) return <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>;
  if (items === null) return <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />;
  if (reason === "no_address") return <p className="text-[13px] text-[var(--color-text-muted)]">Add an email address (or a domain, for a company) to see mail here.</p>;
  if (items.length === 0) return <p className="text-[13px] text-[var(--color-text-muted)]">No mail found in the mailbox you&apos;re working in.</p>;

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-[var(--color-text-faint)]">Read from your mailbox as you open this; nothing is copied into the data model.</p>
      <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {items.map((t) => (
          <li key={t.id}>
            <Link href={`/inbox?thread=${encodeURIComponent(t.id)}`} className="block px-3 py-2.5 hover:bg-[var(--color-surface-2)]">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                  <span className="truncate">{t.subject}</span>
                  {t.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" aria-label="Has attachments" />}
                </span>
                <span className="shrink-0 text-[12px] text-[var(--color-text-faint)]">
                  {new Date(t.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <p className="truncate text-[12.5px] text-[var(--color-text-muted)]">{t.snippet}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
