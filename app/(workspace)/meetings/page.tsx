"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { cn, formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  RefreshCw,
  Trash2,
  Video,
  X,
} from "lucide-react";

type MeetingRow = {
  id: string;
  meeting_url: string;
  fireflies_id: string | null;
  status: string;
  transcript: string | null;
  summary: string | null;
  attendee_email: string | null;
  created_at: string;
};

/* ── helpers ───────────────────────────────────────────── */
function meetingLabel(m: MeetingRow): string {
  if (m.attendee_email) return m.attendee_email;
  try {
    const u = new URL(m.meeting_url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Meeting";
  }
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/* ── sub-components ────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const done = status === "completed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        done
          ? "bg-[var(--color-success-light)] text-[var(--color-success)]"
          : "bg-[var(--color-warning-light)] text-[var(--color-warning)]",
      )}
    >
      {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
      {done ? "Done" : "Pending"}
    </span>
  );
}

function MeetingListItem({
  m,
  active,
  onClick,
}: {
  m: MeetingRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full border-b border-[var(--color-border)] px-4 py-3.5 text-left transition-colors duration-100",
        active
          ? "bg-[var(--color-primary-light)]"
          : "hover:bg-[var(--color-surface-offset)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase",
              active
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]",
            )}
          >
            {meetingLabel(m).slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-[13px] font-semibold leading-tight",
                active ? "text-[var(--color-primary)]" : "text-[var(--color-text)]",
              )}
            >
              {meetingLabel(m)}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">
              {relativeDate(m.created_at)}
            </p>
          </div>
        </div>
        <StatusBadge status={m.status} />
      </div>
      {m.summary ? (
        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {m.summary}
        </p>
      ) : m.status !== "completed" ? (
        <p className="mt-2 text-[12px] text-[var(--color-text-faint)] italic">
          Transcript processing…
        </p>
      ) : null}
    </button>
  );
}

function SkeletonList() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border-b border-[var(--color-border)] px-4 py-3.5">
          <div className="flex items-start gap-2">
            <Skeleton className="skeleton-shimmer h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="skeleton-shimmer h-3 w-2/3 rounded" />
              <Skeleton className="skeleton-shimmer h-2.5 w-1/3 rounded" />
            </div>
            <Skeleton className="skeleton-shimmer h-4 w-14 rounded-full" />
          </div>
          <div className="mt-2 space-y-1">
            <Skeleton className="skeleton-shimmer h-2.5 w-full rounded" />
            <Skeleton className="skeleton-shimmer h-2.5 w-3/4 rounded" />
          </div>
        </div>
      ))}
    </>
  );
}

/* ── delete confirm modal ──────────────────────────────── */
function DeleteModal({
  onConfirm,
  onCancel,
  busy,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="animate-backdrop-in absolute inset-0 bg-[var(--nucleus-deep)]/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="animate-scale-in relative w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-lg)]">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-danger-light)]">
          <Trash2 className="h-5 w-5 text-[var(--color-danger)]" />
        </div>
        <h3 className="font-display text-[15px] font-bold text-[var(--color-text)]">
          Delete meeting?
        </h3>
        <p className="mt-1.5 text-[13px] text-[var(--color-text-muted)]">
          The summary and transcript will be permanently removed from your account.
        </p>
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-danger flex-1"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── detail pane ───────────────────────────────────────── */
function MeetingDetail({
  m,
  sendingId,
  sendSuccessId,
  onSendEmail,
  onDelete,
  onClose,
}: {
  m: MeetingRow;
  sendingId: string | null;
  sendSuccessId: string | null;
  onSendEmail: (id: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}) {
  const done = m.status === "completed";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={m.status} />
            <span className="text-[12px] text-[var(--color-text-faint)]">
              {formatDate(m.created_at)}
            </span>
          </div>
          <h2 className="mt-1.5 font-display text-[15px] font-bold leading-tight text-[var(--color-text)]">
            {meetingLabel(m)}
          </h2>
          {m.attendee_email && (
            <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
              {m.attendee_email}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={m.meeting_url}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost h-8 px-2.5 py-1.5 text-[12px]"
            title="Open meeting link"
          >
            <Video className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open</span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          {done && m.summary && m.attendee_email ? (
            <button
              type="button"
              onClick={() => onSendEmail(m.id)}
              disabled={sendingId === m.id}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              <Mail className="h-3.5 w-3.5" />
              {sendingId === m.id
                ? "Sending…"
                : sendSuccessId === m.id
                  ? "Sent ✓"
                  : "Email summary"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete(m.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
            title="Delete meeting"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-offset)] md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-0 overflow-y-auto">
        {!done ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning-light)]">
              <Clock className="h-5 w-5 text-[var(--color-warning)]" />
            </div>
            <p className="text-[13px] font-medium text-[var(--color-text)]">
              Transcript is processing
            </p>
            <p className="max-w-xs text-[12px] text-[var(--color-text-muted)]">
              Come back soon, or use{" "}
              <strong className="text-[var(--color-text)]">Sync transcripts</strong>{" "}
              to pull the latest from Fireflies.
            </p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                AI Summary
              </p>
              {m.summary ? (
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--color-text)]">
                  {m.summary}
                </p>
              ) : (
                <p className="text-[13px] italic text-[var(--color-text-faint)]">
                  No summary available.
                </p>
              )}
            </div>

            {/* Transcript */}
            <div className="px-5 py-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                Full Transcript
              </p>
              {m.transcript ? (
                <pre className="font-body whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
                  {m.transcript}
                </pre>
              ) : (
                <p className="text-[13px] italic text-[var(--color-text-faint)]">
                  No transcript available.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary-light)]">
        <Video className="h-6 w-6 text-[var(--color-primary)]" />
      </div>
      <p className="text-[14px] font-semibold text-[var(--color-text)]">
        Select a meeting
      </p>
      <p className="max-w-xs text-[12px] text-[var(--color-text-muted)]">
        Pick a meeting from the list to view its AI summary and full transcript.
      </p>
    </div>
  );
}

/* ── page ──────────────────────────────────────────────── */
export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MeetingRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendSuccessId, setSendSuccessId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Mobile: show detail pane over list
  const [mobileDetail, setMobileDetail] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings");
      const json = (await res.json()) as { meetings?: MeetingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load meetings");
      const list = json.meetings || [];
      setMeetings(list);
      // Auto-select first if nothing selected
      setSelected((prev) => {
        if (prev) {
          // Refresh selected row data if it's still in the list
          return list.find((m) => m.id === prev.id) ?? list[0] ?? null;
        }
        return list[0] ?? null;
      });
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  function showError(msg: string) {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  }

  async function sendSummaryEmail(id: string) {
    setSendingId(id);
    setSendSuccessId(null);
    try {
      const res = await fetch("/api/meetings/send-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to send email");
      setSendSuccessId(id);
      setTimeout(() => setSendSuccessId(null), 3000);
    } catch (e) {
      showError(clientFetchFailedMessage(e));
    } finally {
      setSendingId(null);
    }
  }

  async function syncTranscripts() {
    setSyncing(true);
    setSyncInfo(null);
    setError(null);
    try {
      const res = await fetch("/api/meetings/sync", { method: "POST" });
      const body = (await res.json()) as {
        updated?: number;
        transcriptsFetched?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Sync failed");
      const parts = [
        body.message || "",
        typeof body.transcriptsFetched === "number"
          ? `Pulled ${body.transcriptsFetched} transcript(s).`
          : "",
        typeof body.updated === "number" && body.updated > 0
          ? `Saved ${body.updated} meeting(s).`
          : "",
      ].filter(Boolean);
      setSyncInfo(parts.join(" ") || "Up to date.");
      setTimeout(() => setSyncInfo(null), 4000);
      await loadMeetings();
    } catch (e) {
      showError(clientFetchFailedMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const id = confirmDeleteId;
    if (!id) return;
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/meetings/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error?: string; hint?: string };
      if (!res.ok) {
        throw new Error(
          [body.error, body.hint].filter(Boolean).join(" — ") || "Delete failed"
        );
      }
      setMeetings((prev) => {
        const next = prev.filter((m) => m.id !== id);
        if (selected?.id === id) {
          setSelected(next[0] ?? null);
          if (!next[0]) setMobileDetail(false);
        }
        return next;
      });
    } catch (e) {
      showError(clientFetchFailedMessage(e));
    } finally {
      setDeletingId(null);
    }
  }

  const selectedMeeting = selected
    ? (meetings.find((m) => m.id === selected.id) ?? selected)
    : null;

  return (
    <>
      {/* ── Full-bleed master-detail shell ── */}
      <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] flex-col overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">

        {/* Top toolbar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:px-5">
          <div>
            <h1 className="font-display text-[16px] font-bold tracking-tight text-[var(--color-text)]">
              Meetings
            </h1>
            <p className="text-[11px] text-[var(--color-text-faint)]">
              AI transcripts &amp; summaries
            </p>
          </div>
          <div className="flex items-center gap-2">
            {syncInfo && (
              <span className="hidden text-[12px] text-[var(--color-success)] sm:block">
                {syncInfo}
              </span>
            )}
            {error && (
              <span className="hidden max-w-[200px] truncate text-[12px] text-[var(--color-danger)] sm:block">
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadMeetings()}
              disabled={loading || syncing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] disabled:opacity-40"
              title="Refresh list"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => void syncTranscripts()}
              disabled={syncing || loading}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        </div>

        {/* Mobile error / sync banners */}
        {(error || syncInfo) && (
          <div
            className={cn(
              "shrink-0 px-4 py-2 text-[12px] sm:hidden",
              error
                ? "bg-[var(--color-danger-light)] text-[var(--color-danger)]"
                : "bg-[var(--color-success-light)] text-[var(--color-success)]",
            )}
          >
            {error || syncInfo}
          </div>
        )}

        {/* Master-detail body */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── List pane ── */}
          <div
            className={cn(
              "flex w-full shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)]",
              "md:w-[300px]",
              // Mobile: hide when detail is open
              mobileDetail ? "hidden md:flex" : "flex",
            )}
          >
            {loading ? (
              <SkeletonList />
            ) : meetings.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
                  <Video className="h-5 w-5 text-[var(--color-text-faint)]" />
                </div>
                <p className="text-[13px] font-medium text-[var(--color-text)]">
                  No meetings yet
                </p>
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  Sync to pull transcripts from Fireflies.
                </p>
              </div>
            ) : (
              meetings.map((m) => (
                <MeetingListItem
                  key={m.id}
                  m={m}
                  active={selectedMeeting?.id === m.id}
                  onClick={() => {
                    setSelected(m);
                    setMobileDetail(true);
                  }}
                />
              ))
            )}
          </div>

          {/* ── Detail pane ── */}
          <div
            className={cn(
              "flex-1 overflow-hidden bg-[var(--color-bg)]",
              // Mobile: show only when detail open
              mobileDetail ? "flex flex-col" : "hidden md:flex md:flex-col",
            )}
          >
            {selectedMeeting ? (
              <MeetingDetail
                m={selectedMeeting}
                sendingId={sendingId}
                sendSuccessId={sendSuccessId}
                onSendEmail={(id) => void sendSummaryEmail(id)}
                onDelete={(id) => setConfirmDeleteId(id)}
                onClose={() => setMobileDetail(false)}
              />
            ) : (
              <EmptyDetail />
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <DeleteModal
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmDeleteId(null)}
          busy={deletingId !== null}
        />
      )}
    </>
  );
}
