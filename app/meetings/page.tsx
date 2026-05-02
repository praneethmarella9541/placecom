"use client";

import { useCallback, useEffect, useState } from "react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { IconRefresh } from "@/components/Icons";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Meetings & Summaries
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            View AI-generated transcripts and summaries from your Fireflies meetings.
          </p>
        </div>
        <button type="button" onClick={() => void loadMeetings()} className="btn-ghost">
          <IconRefresh className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading meetings...</p>
        ) : meetings.length === 0 ? (
          <div className="card p-5 text-center">
            <p className="text-sm text-zinc-500">No recorded meetings yet.</p>
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
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
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
                    <p className="mt-1 text-xs text-zinc-500">Attendee: {m.attendee_email}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "completed" && m.summary && m.attendee_email ? (
                    <button
                      type="button"
                      onClick={() => void sendSummaryEmail(m.id)}
                      disabled={sendingId === m.id}
                      className="btn-primary"
                    >
                      {sendingId === m.id ? "Sending..." : "Email Summary to Attendee"}
                    </button>
                  ) : null}
                  {sendSuccessId === m.id ? (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400">Sent!</span>
                  ) : null}
                </div>
              </div>

              <div className="p-5">
                {m.status !== "completed" ? (
                  <p className="text-sm text-zinc-500">
                    Waiting for Fireflies to process this meeting. The transcript and summary will appear here automatically when ready.
                  </p>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Summary</h3>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                        {m.summary ? (
                          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                            {m.summary}
                          </p>
                        ) : (
                          <p className="text-sm italic text-zinc-400">No summary provided.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Full Transcript</h3>
                      <div className="max-h-[400px] overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                        {m.transcript ? (
                          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                            {m.transcript}
                          </p>
                        ) : (
                          <p className="text-sm italic text-zinc-400">No transcript available.</p>
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
