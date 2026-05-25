"use client";

import { useCallback, useEffect, useState } from "react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { IconRefresh } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

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

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendSuccessId, setSendSuccessId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings");
      const json = (await res.json()) as { meetings?: MeetingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load meetings");
      setMeetings(json.meetings || []);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  async function sendSummaryEmail(id: string) {
    setSendingId(id);
    setSendSuccessId(null);
    setError(null);
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
      setError(clientFetchFailedMessage(e));
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
        skipped?: number;
        pendingCount?: number;
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
      setSyncInfo(parts.join(" "));
      await loadMeetings();
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  async function deleteMeeting(id: string) {
    if (
      !window.confirm(
        titleCase(
          "Delete this meeting record? The summary and transcript will be removed from your account."
        )
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    setSyncInfo(null);
    setDeleteSuccess(false);
    try {
      const res = await fetch(`/api/meetings/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string; hint?: string };
      if (!res.ok) {
        const msg = [body.error, body.hint].filter(Boolean).join("\n\n");
        throw new Error(msg || "Delete failed");
      }
      setSendSuccessId((cur) => (cur === id ? null : cur));
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setDeleteSuccess(true);
      setTimeout(() => setDeleteSuccess(false), 3500);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {titleCase("Meetings & summaries")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {titleCase("View AI-generated transcripts and summaries from synced meetings.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void syncTranscripts()}
            disabled={syncing}
            className="btn-primary gap-2"
          >
            <IconRefresh className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? titleCase("Syncing…") : titleCase("Sync transcripts")}
          </button>
          <button type="button" onClick={() => void loadMeetings()} className="btn-ghost" disabled={syncing}>
            <IconRefresh className="h-4 w-4" /> {titleCase("Refresh list")}
          </button>
        </div>
      </div>

      {syncInfo ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
          {syncInfo}
        </div>
      ) : null}

      {deleteSuccess ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
          {titleCase(
            "Meeting deleted — summary and transcript were removed from your account."
          )}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6">
        {loading ? (
          <p className="text-sm text-zinc-500">{titleCase("Loading meetings...")}</p>
        ) : meetings.length === 0 ? (
          <div className="card p-5 text-center">
            <p className="text-sm text-zinc-500">{titleCase("No recorded meetings yet.")}</p>
          </div>
        ) : (
          meetings.map((m) => (
            <div key={m.id} className="card overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-zinc-200 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/20 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {formatDate(m.created_at)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        m.status === "completed"
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>
                  <a
                    href={m.meeting_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {m.meeting_url}
                  </a>
                  {m.attendee_email ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      {titleCase("Attendee:")} {m.attendee_email}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.status === "completed" && m.summary && m.attendee_email ? (
                    <button
                      type="button"
                      onClick={() => void sendSummaryEmail(m.id)}
                      disabled={sendingId === m.id || deletingId === m.id}
                      className="btn-primary"
                    >
                      {sendingId === m.id
                        ? titleCase("Sending...")
                        : titleCase("Email summary to attendee")}
                    </button>
                  ) : null}
                  {sendSuccessId === m.id ? (
                    <span className="text-sm text-indigo-600 dark:text-indigo-400">
                      {titleCase("Sent!")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void deleteMeeting(m.id)}
                    disabled={deletingId === m.id || syncing}
                    className="btn-danger"
                  >
                    {deletingId === m.id ? titleCase("Deleting…") : titleCase("Delete")}
                  </button>
                </div>
              </div>

              <div className="p-5">
                {m.status !== "completed" ? (
                  <p className="text-sm text-zinc-500">
                    {titleCase("Waiting for the transcript to be ready. If it stays empty, use")}{" "}
                    <strong>{titleCase("Sync transcripts")}</strong>{" "}
                    {titleCase("above to pull the latest.")}
                  </p>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs tracking-wide text-zinc-500">{titleCase("Summary")}</h3>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                        {m.summary ? (
                          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                            {m.summary}
                          </p>
                        ) : (
                          <p className="text-sm italic text-zinc-400">{titleCase("No summary provided.")}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-2 text-xs tracking-wide text-zinc-500">
                        {titleCase("Full transcript")}
                      </h3>
                      <div className="max-h-[400px] overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                        {m.transcript ? (
                          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                            {m.transcript}
                          </p>
                        ) : (
                          <p className="text-sm italic text-zinc-400">{titleCase("No transcript available.")}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
