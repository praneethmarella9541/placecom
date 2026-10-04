"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCalendar, IconMail, IconMenu, IconWhatsApp } from "@/components/Icons";
import { EmailThreadPreviewModal } from "@/components/EmailThreadPreviewModal";
import { useModuleVisibility } from "@/lib/module-visibility";
import { titleCase } from "@/lib/title-case";
import type { ContactNoteRow } from "@/app/api/directory-contacts/[id]/notes/route";
import type { TimelineItem } from "@/app/api/directory-contacts/[id]/timeline/route";

type Tab = "All Interaction" | "Emails" | "Meetings" | "WhatsApp" | "Notes";

const SOURCE_BY_TAB: Partial<Record<Tab, TimelineItem["type"]>> = {
  Emails: "email",
  Meetings: "meeting",
  WhatsApp: "whatsapp",
};

const ICON_BY_TYPE: Record<TimelineItem["type"] | "note", React.ComponentType<{ className?: string }>> = {
  email: IconMail,
  meeting: IconCalendar,
  whatsapp: IconWhatsApp,
  note: IconMenu,
};

/**
 * Tabbed unified activity feed for a contact — pulls Gmail, calendar, WhatsApp,
 * and notes.
 *
 * The WhatsApp tab and its source are both conditional: the module ships
 * switched off, and its /api/directory-contacts/[id]/timeline?source=whatsapp
 * read is gated with it, so showing the tab regardless would mean an empty tab
 * backed by a 403.
 */
export function ContactActivityTimeline({ contactId }: { contactId: string }) {
  const whatsappEnabled = useModuleVisibility().isVisible("whatsapp");
  const TABS = useMemo<Tab[]>(
    () =>
      whatsappEnabled
        ? ["All Interaction", "Emails", "Meetings", "WhatsApp", "Notes"]
        : ["All Interaction", "Emails", "Meetings", "Notes"],
    [whatsappEnabled],
  );
  /** Sources merged for "All Interaction", and warmed together. */
  const ALL_SOURCES = useMemo<readonly TimelineItem["type"][]>(
    () => (whatsappEnabled ? ["email", "meeting", "whatsapp"] : ["email", "meeting"]),
    [whatsappEnabled],
  );

  const [activeTab, setActiveTab] = useState<Tab>("All Interaction");
  const [sources, setSources] = useState<Partial<Record<TimelineItem["type"], TimelineItem[] | "loading" | "error">>>({});
  const [notes, setNotes] = useState<ContactNoteRow[] | "loading" | "error" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);

  const loadSource = useCallback(
    async (type: TimelineItem["type"]) => {
      setSources((prev) => ({ ...prev, [type]: "loading" }));
      try {
        const res = await fetch(`/api/directory-contacts/${contactId}/timeline?source=${type}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to load");
        setSources((prev) => ({ ...prev, [type]: json.items ?? [] }));
      } catch {
        setSources((prev) => ({ ...prev, [type]: "error" }));
      }
    },
    [contactId]
  );

  const loadNotes = useCallback(async () => {
    setNotes("loading");
    try {
      const res = await fetch(`/api/directory-contacts/${contactId}/notes`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setNotes(json.notes ?? []);
    } catch {
      setNotes("error");
    }
  }, [contactId]);

  // Reset caches when navigating to a different contact.
  useEffect(() => {
    setSources({});
    setNotes(null);
    setActiveTab("All Interaction");
  }, [contactId]);

  useEffect(() => {
    if (activeTab === "Notes" && notes === null) void loadNotes();
    const single = SOURCE_BY_TAB[activeTab];
    if (single && sources[single] === undefined) void loadSource(single);
    if (activeTab === "All Interaction") {
      ALL_SOURCES.forEach((t) => {
        if (sources[t] === undefined) void loadSource(t);
      });
      if (notes === null) void loadNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, contactId, ALL_SOURCES]);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/directory-contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteText.trim(), kind: "note" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to add note");
      setNotes((prev) => (Array.isArray(prev) ? [json.note, ...prev] : [json.note]));
      setNoteText("");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSubmittingNote(false);
    }
  }

  const isAll = activeTab === "All Interaction";
  const singleSource = SOURCE_BY_TAB[activeTab];

  const allItems: (TimelineItem | { id: string; type: "note"; summary: string; at: string })[] = isAll
    ? [
        ...ALL_SOURCES.flatMap((t) => {
          const v = sources[t];
          return Array.isArray(v) ? v : [];
        }),
        ...(Array.isArray(notes) ? notes.map((n) => ({ id: n.id, type: "note" as const, summary: n.body, at: n.created_at })) : []),
      ].sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    : [];

  const loadingAll =
    isAll &&
    ALL_SOURCES.some((t) => sources[t] === "loading" || sources[t] === undefined);

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {TABS.map((tab) => (
          <button
            key={tab}
            data-testid={`contact-tab-${tab.toLowerCase().replace(/\s+/g, "-")}`}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
              activeTab === tab
                ? "border-[var(--color-copper)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {titleCase(tab)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === "Notes" ? (
          <div className="space-y-4">
            <form onSubmit={(e) => void handleAddNote(e)} className="space-y-2">
              <textarea
                data-testid="contact-note-input"
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={titleCase("Add a note…")}
                className="input-field w-full text-[13px]"
              />
              <div className="flex justify-end">
                <button
                  data-testid="contact-note-submit"
                  type="submit"
                  disabled={submittingNote || !noteText.trim()}
                  className="btn-primary-copper px-4 disabled:opacity-60"
                >
                  {submittingNote ? "Saving…" : titleCase("Add note")}
                </button>
              </div>
            </form>
            {notes === "loading" || notes === null ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
            ) : notes === "error" ? (
              <p className="text-[13px] text-[var(--color-danger)]">{titleCase("Failed to load notes.")}</p>
            ) : notes.length === 0 ? (
              <p className="text-[13px] italic text-[var(--color-text-muted)]">{titleCase("No notes yet.")}</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <p className="text-[13px] text-[var(--color-text)]">{n.body}</p>
                    <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : isAll ? (
          loadingAll ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
          ) : allItems.length === 0 ? (
            <p className="text-[13px] italic text-[var(--color-text-muted)]">{titleCase("No activity yet.")}</p>
          ) : (
            <TimelineList items={allItems} onOpenThread={setPreviewThreadId} />
          )
        ) : (
          <SourceTab items={singleSource ? sources[singleSource] : undefined} onOpenThread={setPreviewThreadId} />
        )}
      </div>

      {previewThreadId && (
        <EmailThreadPreviewModal
          threadId={previewThreadId}
          onClose={() => setPreviewThreadId(null)}
        />
      )}
    </div>
  );
}

function SourceTab({
  items,
  onOpenThread,
}: {
  items: TimelineItem[] | "loading" | "error" | undefined;
  onOpenThread: (threadId: string) => void;
}) {
  if (items === undefined || items === "loading") {
    return <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>;
  }
  if (items === "error") {
    return <p className="text-[13px] text-[var(--color-danger)]">{titleCase("Failed to load.")}</p>;
  }
  if (items.length === 0) {
    return <p className="text-[13px] italic text-[var(--color-text-muted)]">{titleCase("No activity yet.")}</p>;
  }
  // Same newest-first ordering as the merged "All Interaction" tab — the API
  // returns each source (Gmail, calendar) in its own native
  // order, which isn't guaranteed to be newest-first (calendar events come
  // back oldest-first), so this can't just trust the fetch order.
  const sorted = [...items].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return <TimelineList items={sorted} onOpenThread={onOpenThread} />;
}

function TimelineList({
  items,
  onOpenThread,
}: {
  items: (TimelineItem | { id: string; type: "note"; summary: string; at: string })[];
  onOpenThread: (threadId: string) => void;
}) {
  const mailEnabled = useModuleVisibility().isVisible("inbox");
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const Icon = ICON_BY_TYPE[item.type];
        const threadId = "threadId" in item ? item.threadId : undefined;
        // Opening a row shows the mail thread, which needs the Mail module —
        // without it the row stays visible as history but is inert.
        const clickable = Boolean(threadId) && mailEnabled;
        return (
          <li
            key={`${item.type}-${item.id}`}
            onClick={clickable ? () => onOpenThread(threadId!) : undefined}
            className={`flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
              clickable ? "cursor-pointer transition-colors hover:bg-[var(--color-surface-offset)]" : ""
            }`}
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
              <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[var(--color-text)]">{item.summary}</p>
              {"detail" in item && item.detail && (
                <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{item.detail}</p>
              )}
              <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                {item.at ? new Date(item.at).toLocaleString() : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
