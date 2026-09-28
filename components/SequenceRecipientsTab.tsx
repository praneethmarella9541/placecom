"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MoreVertical, Play, Pause, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { EnrollmentStatusPill } from "@/components/SequenceStatusPill";
import { Skeleton } from "@/components/Skeleton";
import { MERGE_FIELD_ALIAS_KEYS } from "@/lib/compose-variables";
import { formatInTimeZone } from "@/lib/sequence-schedule";
import {
  loadRecipientSuggestions,
  searchRecipientSuggestions,
} from "@/lib/sequence-suggestions";
import { titleCase } from "@/lib/title-case";
import type { Sequence, SequenceEnrollment } from "@/lib/sequence-types";

type Props = {
  sequence: Sequence;
  /** Owned by SequenceEditor — the step editor reads the same list. */
  enrollments: SequenceEnrollment[];
  loading: boolean;
  /** Re-fetches the list and the tallies after this tab changes something. */
  onChanged: () => Promise<void>;
};

export function SequenceRecipientsTab({ sequence, enrollments, loading, onChanged }: Props) {
  const [recipients, setRecipients] = useState("");
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The row menu is positioned in viewport coordinates and portalled to
   * <body>, because the workspace <main> is overflow-hidden
   * (WorkspaceChrome.tsx) — an absolutely-positioned menu on the last rows was
   * being clipped at the bottom of the page rather than overflowing it. Same
   * reason RichTextEditor portals its variable picker.
   */
  const [menu, setMenu] = useState<{
    id: string;
    top: number;
    left: number;
    flipUp: boolean;
  } | null>(null);
  const [editingCcId, setEditingCcId] = useState<string | null>(null);
  const [ccDraft, setCcDraft] = useState("");
  const [savingCc, setSavingCc] = useState(false);

  useEffect(() => {
    void loadRecipientSuggestions().then(setSuggestions);
  }, []);

  // Fold in server-side matches for people not in the cached contact dump.
  useEffect(() => {
    const draft = recipients.split(",").pop()?.trim() ?? "";
    if (draft.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchRecipientSuggestions(draft).then((found) => {
        if (cancelled || found.length === 0) return;
        setSuggestions((prev) => {
          const seen = new Set(prev.map((p) => p.email.toLowerCase()));
          const extra = found.filter((f) => !seen.has(f.email.toLowerCase()));
          return extra.length ? [...prev, ...extra] : prev;
        });
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipients]);

  async function handleAdd() {
    if (adding || !recipients.trim()) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequence.id)}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients }),
      });
      const data = (await res.json()) as {
        error?: string;
        added?: number;
        revived?: number;
        skipped?: { email: string; reason: string }[];
        warnings?: { email: string; otherSequenceName?: string }[];
      };
      if (!res.ok) throw new Error(data.error || "Could not add recipients");

      const bits: string[] = [];
      if (data.added) bits.push(`Added ${data.added}.`);
      // Worth naming separately: these start from step 1 again rather than
      // picking up where they were when they were removed.
      if (data.revived) {
        bits.push(`Re-added ${data.revived} previously removed, starting from the first email.`);
      }
      const dupes = (data.skipped ?? []).filter((s) => s.reason === "duplicate").length;
      if (dupes) bits.push(`${dupes} already enrolled.`);
      for (const warning of data.warnings ?? []) {
        if (warning.otherSequenceName) {
          bits.push(`${warning.email} is also active in "${warning.otherSequenceName}".`);
        }
      }
      setNotice(bits.join(" ") || "Nothing to add.");
      setRecipients("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add recipients");
    } finally {
      setAdding(false);
    }
  }

  function startEditCc(enrollment: SequenceEnrollment) {
    setMenu(null);
    setEditingCcId(enrollment.id);
    setCcDraft(enrollment.cc ?? "");
  }

  async function saveCc(enrollmentId: string) {
    setSavingCc(true);
    try {
      await fetch(
        `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments/${encodeURIComponent(enrollmentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cc: ccDraft }),
        },
      );
      setEditingCcId(null);
      await onChanged();
    } finally {
      setSavingCc(false);
    }
  }

  async function act(enrollmentId: string, action: "pause" | "resume" | "restart") {
    setMenu(null);
    await fetch(
      `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments/${encodeURIComponent(enrollmentId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    await onChanged();
  }

  async function remove(enrollmentId: string) {
    setMenu(null);
    await fetch(
      `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments/${encodeURIComponent(enrollmentId)}`,
      { method: "DELETE" },
    );
    await onChanged();
  }

  /** Roughly the rendered menu: four 42px rows inside a 1px border. */
  const MENU_WIDTH = 176;
  const MENU_HEIGHT = 172;

  function toggleMenu(id: string, anchor: HTMLElement) {
    if (menu?.id === id) {
      setMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    // Open upward when the menu would run off the bottom of the window — the
    // last row of a long list is exactly where this menu is most used.
    const flipUp = rect.bottom + MENU_HEIGHT > window.innerHeight - 8;
    setMenu({
      id,
      top: flipUp ? rect.top - 4 : rect.bottom + 4,
      // Right-aligned to the button, but never off the left edge.
      left: Math.max(8, rect.right - MENU_WIDTH),
      flipUp,
    });
  }

  // Fixed coordinates are a snapshot: once anything scrolls or the window
  // resizes they point somewhere the button no longer is.
  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const menuTarget = menu ? (enrollments.find((e) => e.id === menu.id) ?? null) : null;

  const canAdd = useMemo(() => recipients.trim().length > 0 && !adding, [recipients, adding]);
  const sequenceActive = sequence.status === "active";

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <UserPlus className="h-4 w-4 text-[var(--color-copper)]" strokeWidth={2} />
          <h2 className="text-[14px] font-semibold text-[var(--color-text)]">
            {titleCase("Enroll recipients")}
          </h2>
        </div>
        <p className="mb-3 text-[12.5px] text-[var(--color-text-muted)]">
          {titleCase(
            "Start typing to pick from your contacts and past conversations, or paste any email address.",
          )}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <RecipientField
              value={recipients}
              onChange={setRecipients}
              placeholder="Add people by name or email"
              suggestions={suggestions}
            />
          </div>
          <button
            data-testid="sequence-enroll-btn"
            type="button"
            onClick={() => void handleAdd()}
            disabled={!canAdd}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-copper)] px-5 text-[14px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)] disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {titleCase(adding ? "Adding…" : "Enroll")}
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--color-text-faint)]">
          {titleCase(
            'Add Cc addresses for a specific recipient afterward, from the "⋮" menu on their row below.',
          )}
        </p>
        {!sequenceActive ? (
          <p className="mt-3 text-[12.5px] text-[var(--color-text-faint)]">
            {titleCase(
              sequence.status === "draft"
                ? "This sequence is not enabled yet — recipients start receiving email once you enable it."
                : "This sequence is disabled — no email goes out. Everyone below keeps their place and resumes from there when you enable it.",
            )}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-[12.5px] text-[var(--color-text-muted)]">{notice}</p>
        ) : null}
        {error ? (
          <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p>
        ) : null}
      </div>

      {!loading && enrollments.length > 0 ? (
        <p className="text-[12.5px] text-[var(--color-text-muted)]">
          {titleCase(
            "Merge variables are read from each recipient's Team Directory card and mailbox history every time a step is previewed or sent — editing a contact updates them here.",
          )}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="skeleton-shimmer h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : enrollments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
          {titleCase("No recipients yet.")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {enrollments.map((e) => (
            <li
              key={e.id}
              data-testid={`sequence-recipient-${e.id}`}
              className="flex flex-col gap-2.5 px-5 py-3.5"
            >
              <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-[var(--color-text)]">
                  {e.displayName?.trim() || e.email}
                </p>
                <p className="font-mono mt-0.5 truncate text-[11.5px] text-[var(--color-text-faint)]">
                  {e.displayName?.trim() ? `${e.email} · ` : ""}
                  {e.lastError
                    ? e.lastError
                    : e.status === "active" && !sequenceActive
                      ? // Same reason the pill says "On hold": with the sequence
                        // disabled the scheduler never claims this row, so a
                        // "Next"/"Due" time would name a moment nothing happens at.
                        titleCase("Waiting — the sequence is disabled")
                      : e.nextRunAt
                        ? new Date(e.nextRunAt).getTime() <= Date.now()
                          ? // The scheduler is an external cron hitting /api/cron/sequences on
                            // its own interval, not something this page can trigger — a slot
                            // that has passed just means it hasn't ticked yet, not that
                            // anything is wrong. Says so plainly instead of showing a "Next"
                            // time that's already behind the clock.
                            `${titleCase("Due")} ${formatInTimeZone(new Date(e.nextRunAt), sequence.timezone)} — ${titleCase("waiting for the next send run")}`
                          : `${titleCase("Next")} ${formatInTimeZone(new Date(e.nextRunAt), sequence.timezone)}`
                        : e.lastSentAt
                          ? `${titleCase("Last sent")} ${formatInTimeZone(new Date(e.lastSentAt), sequence.timezone)}`
                          : titleCase("Not scheduled")}
                </p>
                {editingCcId !== e.id && e.cc?.trim() ? (
                  <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-muted)]">
                    {titleCase("Cc")}: {e.cc}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <RecipientFieldCount mergeFields={e.mergeFields} />
                <span className="font-mono text-[11.5px] text-[var(--color-text-faint)]">
                  {titleCase("Step")} {e.currentStepOrder}
                </span>
                <EnrollmentStatusPill status={e.status} sequenceActive={sequenceActive} />
                <button
                  type="button"
                  aria-label="Recipient actions"
                  aria-expanded={menu?.id === e.id}
                  onClick={(ev) => toggleMenu(e.id, ev.currentTarget)}
                  className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                >
                  <MoreVertical className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              </div>
              {editingCcId === e.id ? (
                <div
                  className="flex items-start gap-2"
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape") setEditingCcId(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <RecipientField
                      value={ccDraft}
                      onChange={setCcDraft}
                      placeholder="Cc addresses"
                      suggestions={suggestions}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveCc(e.id)}
                    disabled={savingCc}
                    className="h-9 shrink-0 rounded-lg bg-[var(--color-copper)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60"
                  >
                    {titleCase("Save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCcId(null)}
                    className="h-9 shrink-0 rounded-lg px-3 text-[12.5px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                  >
                    {titleCase("Cancel")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {menu && menuTarget && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-[1000] cursor-default"
                onClick={() => setMenu(null)}
              />
              <div
                role="menu"
                style={{ top: menu.top, left: menu.left }}
                className={`fixed z-[1001] w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)] ${
                  menu.flipUp ? "-translate-y-full" : ""
                }`}
              >
                {menuTarget.status === "active" ? (
                  <MenuItem
                    icon={Pause}
                    label="Pause"
                    onClick={() => void act(menuTarget.id, "pause")}
                  />
                ) : (
                  <MenuItem
                    icon={Play}
                    label="Resume"
                    onClick={() => void act(menuTarget.id, "resume")}
                  />
                )}
                <MenuItem
                  icon={RotateCcw}
                  label="Restart"
                  onClick={() => void act(menuTarget.id, "restart")}
                />
                <MenuItem
                  icon={Users}
                  label={menuTarget.cc?.trim() ? "Edit Cc" : "Add Cc"}
                  onClick={() => startEditCc(menuTarget)}
                />
                <MenuItem
                  icon={Trash2}
                  label="Remove"
                  danger
                  onClick={() => void remove(menuTarget.id)}
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * How many merge variables this recipient can fill, listed on hover.
 *
 * The aliases contactToMergeFields writes ({company} for {company_name} and
 * friends) are left out — counting one value twice would overstate what is
 * actually known about the person.
 */
function RecipientFieldCount({ mergeFields }: { mergeFields: Record<string, string> }) {
  const keys = Object.keys(mergeFields)
    .filter(
      (k) =>
        !(MERGE_FIELD_ALIAS_KEYS as readonly string[]).includes(k) && mergeFields[k]?.trim(),
    )
    .sort();
  if (keys.length === 0) return null;

  return (
    <span
      className="font-mono text-[11.5px] text-[var(--color-text-faint)]"
      title={`${titleCase("Variables that can fill for this recipient")}: ${keys
        .map((k) => `{${k}}`)
        .join(", ")}`}
    >
      {keys.length} {titleCase(keys.length === 1 ? "field" : "fields")}
    </span>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-offset)] ${
        danger ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {titleCase(label)}
    </button>
  );
}
