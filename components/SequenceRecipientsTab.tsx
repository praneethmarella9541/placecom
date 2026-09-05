"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MoreVertical, Play, Pause, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { EnrollmentStatusPill } from "@/components/SequenceStatusPill";
import { Skeleton } from "@/components/Skeleton";
import { formatInTimeZone } from "@/lib/sequence-schedule";
import {
  loadRecipientSuggestions,
  searchRecipientSuggestions,
} from "@/lib/sequence-suggestions";
import { titleCase } from "@/lib/title-case";
import type { Sequence, SequenceEnrollment } from "@/lib/sequence-types";

type Props = {
  sequence: Sequence;
  onCountsChanged: () => void;
};

export function SequenceRecipientsTab({ sequence, onCountsChanged }: Props) {
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState("");
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editingCcId, setEditingCcId] = useState<string | null>(null);
  const [ccDraft, setCcDraft] = useState("");
  const [savingCc, setSavingCc] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { error?: string; enrollments?: SequenceEnrollment[] };
      if (!res.ok) throw new Error(data.error || "Failed to load recipients");
      setEnrollments(data.enrollments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipients");
    } finally {
      setLoading(false);
    }
  }, [sequence.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
        skipped?: { email: string; reason: string }[];
        warnings?: { email: string; otherSequenceName?: string }[];
      };
      if (!res.ok) throw new Error(data.error || "Could not add recipients");

      const bits: string[] = [];
      if (data.added) bits.push(`Added ${data.added}.`);
      const dupes = (data.skipped ?? []).filter((s) => s.reason === "duplicate").length;
      if (dupes) bits.push(`${dupes} already enrolled.`);
      for (const warning of data.warnings ?? []) {
        if (warning.otherSequenceName) {
          bits.push(`${warning.email} is also active in "${warning.otherSequenceName}".`);
        }
      }
      setNotice(bits.join(" ") || "Nothing to add.");
      setRecipients("");
      await load();
      onCountsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add recipients");
    } finally {
      setAdding(false);
    }
  }

  function startEditCc(enrollment: SequenceEnrollment) {
    setOpenMenu(null);
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
      await load();
    } finally {
      setSavingCc(false);
    }
  }

  async function act(enrollmentId: string, action: "pause" | "resume" | "restart") {
    setOpenMenu(null);
    await fetch(
      `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments/${encodeURIComponent(enrollmentId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    await load();
    onCountsChanged();
  }

  async function remove(enrollmentId: string) {
    setOpenMenu(null);
    await fetch(
      `/api/sequences/${encodeURIComponent(sequence.id)}/enrollments/${encodeURIComponent(enrollmentId)}`,
      { method: "DELETE" },
    );
    await load();
    onCountsChanged();
  }

  const canAdd = useMemo(() => recipients.trim().length > 0 && !adding, [recipients, adding]);

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
        {sequence.status !== "active" ? (
          <p className="mt-3 text-[12.5px] text-[var(--color-text-faint)]">
            {titleCase(
              "This sequence is not enabled yet — recipients will start receiving email once you publish it.",
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
                <span className="font-mono text-[11.5px] text-[var(--color-text-faint)]">
                  {titleCase("Step")} {e.currentStepOrder}
                </span>
                <EnrollmentStatusPill status={e.status} />
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Recipient actions"
                    onClick={() => setOpenMenu(openMenu === e.id ? null : e.id)}
                    className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                  >
                    <MoreVertical className="h-4 w-4" strokeWidth={2} />
                  </button>
                  {openMenu === e.id ? (
                    <>
                      <button
                        type="button"
                        aria-hidden
                        tabIndex={-1}
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setOpenMenu(null)}
                      />
                      <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
                        {e.status === "active" ? (
                          <MenuItem icon={Pause} label="Pause" onClick={() => void act(e.id, "pause")} />
                        ) : (
                          <MenuItem icon={Play} label="Resume" onClick={() => void act(e.id, "resume")} />
                        )}
                        <MenuItem
                          icon={RotateCcw}
                          label="Restart"
                          onClick={() => void act(e.id, "restart")}
                        />
                        <MenuItem
                          icon={Users}
                          label={e.cc?.trim() ? "Edit Cc" : "Add Cc"}
                          onClick={() => startEditCc(e)}
                        />
                        <MenuItem
                          icon={Trash2}
                          label="Remove"
                          danger
                          onClick={() => void remove(e.id)}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
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
    </div>
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
