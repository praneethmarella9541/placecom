"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, MessageCircle, Sparkles, StickyNote } from "lucide-react";
import { IconX } from "@/components/Icons";
import { EmailThreadPreviewModal } from "@/components/EmailThreadPreviewModal";
import type { CrmStage } from "@/lib/crm-stages-types";
import { titleCase } from "@/lib/title-case";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type CrmLead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  stage_id: string | null;
  stage_set_by: "human" | "ai";
  ai_confidence: number | null;
  ai_rationale: string | null;
  ai_classified_at: string | null;
  /** directory_contacts row this lead came from — lets the import picker skip it. */
  source_contact_id?: string | null;
};

type EvidenceItem = {
  channel: "mail" | "whatsapp" | "note";
  direction: "in" | "out" | "unknown";
  date: string;
  text: string;
  threadId?: string;
  subject?: string;
  snippet?: string;
};

type EvidenceResponse = {
  seasonStart: string | null;
  mailIncluded: boolean;
  mailError: string | null;
  mail: EvidenceItem[];
  whatsapp: EvidenceItem[];
  notes: EvidenceItem[];
};

type Tab = "judgement" | "mail" | "whatsapp";

/**
 * Lead detail. The AI's verdict and the evidence behind it live side by side
 * on purpose — a confidence score is only worth anything if you can check what
 * it was read from, and the same tabs make it obvious when a lead was placed
 * on thin evidence.
 */
export function CrmLeadModal({
  lead,
  stages,
  onClose,
  onReclassify,
  onMove,
}: {
  lead: CrmLead;
  stages: CrmStage[];
  onClose: () => void;
  onReclassify: (leadId: string) => void;
  /** Moving from here is the keyboard/touch path — the board itself uses drag and drop. */
  onMove: (leadId: string, stageId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("judgement");
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/crm/leads/${lead.id}/evidence`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to load activity");
        if (!cancelled) setData(json as EvidenceResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !previewThreadId) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previewThreadId]);


  const TABS: { key: Tab; label: string; Icon: React.ElementType; count?: number }[] = [
    { key: "judgement", label: "AI judgement", Icon: Sparkles },
    { key: "mail", label: "Mail", Icon: Mail, count: data?.mail.length },
    { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, count: data?.whatsapp.length },
  ];

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-lead-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="crm-lead-title" className="font-display truncate text-lg font-bold text-[var(--color-text)]">
              {lead.company_name}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-muted)]">
              {[lead.contact_name, lead.email].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-1.5 -mt-0.5 shrink-0 p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 px-6">
          <div className="flex gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/70 p-1.5">
            {TABS.map(({ key, label, Icon, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold transition-colors",
                  tab === key
                    ? "border-[var(--color-copper)]/40 bg-[var(--color-copper-tint)] text-[var(--color-copper)] shadow-sm"
                    : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/60 hover:text-[var(--color-text)]"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
                {typeof count === "number" && (
                  <span className="text-[11px] font-normal opacity-70">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {tab === "judgement" ? (
            <JudgementTab
              lead={lead}
              stages={stages}
              onMove={onMove}
              notes={data?.notes ?? []}
            />
          ) : loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-14 rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
          ) : tab === "mail" ? (
            <MailTab
              items={data?.mail ?? []}
              seasonStart={data?.seasonStart ?? null}
              mailError={data?.mailIncluded === false ? data.mailError : null}
              onOpenThread={setPreviewThreadId}
            />
          ) : (
            <WhatsAppTab items={data?.whatsapp ?? []} seasonStart={data?.seasonStart ?? null} />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-6 py-3.5">
          <span className="text-[11.5px] text-[var(--color-text-faint)]">
            {data?.seasonStart
              ? `Showing activity since ${data.seasonStart}`
              : titleCase("No season cutoff set — showing all activity")}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost px-4" onClick={onClose}>
              {titleCase("Close")}
            </button>
            <button
              type="button"
              className="btn-secondary gap-1.5 px-4"
              onClick={() => onReclassify(lead.id)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {titleCase("Re-classify")}
            </button>
          </div>
        </div>
      </div>

      {previewThreadId && (
        <EmailThreadPreviewModal
          threadId={previewThreadId}
          onClose={() => setPreviewThreadId(null)}
        />
      )}
    </div>,
    document.body
  );
}

function JudgementTab({
  lead,
  stages,
  onMove,
  notes,
}: {
  lead: CrmLead;
  stages: CrmStage[];
  onMove: (leadId: string, stageId: string) => void;
  notes: EvidenceItem[];
}) {
  const humanPlaced = lead.stage_set_by === "human";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/40 p-4">
        <div className="flex items-end justify-between gap-3">
          {/* The column is a control, not a readout — this is the accessible
              and touch path for moving a lead now that the board cards
              themselves use drag and drop. */}
          <div className="min-w-0 flex-1">
            <label
              htmlFor="crm-lead-stage"
              className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]"
            >
              {titleCase("Column")}
            </label>
            <select
              id="crm-lead-stage"
              value={lead.stage_id ?? ""}
              onChange={(e) => onMove(lead.id, e.target.value)}
              className="input-field mt-1 h-9 w-full cursor-pointer text-[13px] font-semibold"
            >
              {lead.stage_id === null && <option value="">{titleCase("Unplaced")}</option>}
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {!humanPlaced && lead.ai_confidence !== null && (
            <div className="shrink-0 pb-2 text-right">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                {titleCase("Confidence")}
              </p>
              <p className="mt-1 text-[15px] font-bold text-[var(--color-copper)]">
                {Math.round(lead.ai_confidence * 100)}%
              </p>
            </div>
          )}
        </div>
      </div>

      {humanPlaced ? (
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-[13px] font-semibold text-[var(--color-text)]">
            {titleCase("Placed by hand")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
            {titleCase(
              "Someone moved this card, so the classifier's earlier reasoning was cleared and re-classification will leave it alone. Use Re-classify below to hand it back to the model."
            )}
          </p>
        </div>
      ) : lead.ai_rationale ? (
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            {titleCase("Why")}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text)]">
            {lead.ai_rationale}
          </p>
          {lead.ai_classified_at && (
            <p className="mt-2 text-[11.5px] text-[var(--color-text-faint)]">
              {titleCase("Classified")} {timeAgo(lead.ai_classified_at)}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] p-4 text-center">
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {titleCase("Not classified yet.")}
          </p>
        </div>
      )}

      {notes.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            <StickyNote className="h-3.5 w-3.5" />
            {titleCase(`Logged notes (${notes.length})`)}
          </p>
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li
                key={`${n.date}-${i}`}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <p className="text-[12.5px] leading-relaxed text-[var(--color-text)]">{n.text}</p>
                <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                  {n.date ? timeAgo(n.date) : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function EmptyWindow({ seasonStart, what }: { seasonStart: string | null; what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-10 text-center">
      <p className="text-[13px] text-[var(--color-text-muted)]">
        {seasonStart
          ? `No ${what} with this lead since ${seasonStart}.`
          : `No ${what} with this lead.`}
      </p>
    </div>
  );
}

function MailTab({
  items,
  seasonStart,
  mailError,
  onOpenThread,
}: {
  items: EvidenceItem[];
  seasonStart: string | null;
  mailError: string | null;
  onOpenThread: (threadId: string) => void;
}) {
  if (mailError) {
    return (
      <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning-light)] px-4 py-3 text-[12.5px] text-[var(--color-text)]">
        {titleCase("Mail couldn't be read")}: {mailError}
      </div>
    );
  }
  if (items.length === 0) return <EmptyWindow seasonStart={seasonStart} what="mail" />;

  return (
    <ul className="space-y-1.5">
      {items.map((m, i) => (
        <li key={m.threadId ?? `${m.date}-${i}`}>
          <button
            type="button"
            disabled={!m.threadId}
            onClick={() => m.threadId && onOpenThread(m.threadId)}
            className="flex w-full items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors enabled:hover:bg-[var(--color-surface-offset)] disabled:cursor-default"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                {m.subject || "(no subject)"}
              </p>
              {m.snippet && (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  {m.snippet}
                </p>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">
              {m.date ? timeAgo(m.date) : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WhatsAppTab({ items, seasonStart }: { items: EvidenceItem[]; seasonStart: string | null }) {
  if (items.length === 0) return <EmptyWindow seasonStart={seasonStart} what="WhatsApp messages" />;

  // Oldest first — a chat reads top-down, unlike the mail list.
  const ordered = [...items].reverse();

  return (
    <div className="space-y-2">
      {ordered.map((m, i) => {
        const outbound = m.direction === "out";
        return (
          <div
            key={`${m.date}-${i}`}
            className={cn("flex", outbound ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-2",
                outbound
                  ? "rounded-br-sm bg-[var(--color-whatsapp-bubble-out)] text-[var(--color-text)]"
                  : "rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
              )}
            >
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-text)]">
                {m.text}
              </p>
              <p className="mt-1 text-right text-[10.5px] text-[var(--color-text-faint)]">
                {m.date ? timeAgo(m.date) : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
