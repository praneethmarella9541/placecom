"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { IconPhone, IconRefresh } from "@/components/Icons";

type RecruiterRow = {
  email: string;
  name: string;
  companyName: string;
  source: string;
};

type TranscriptSegment = {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
};

type CallLogRow = {
  id: string;
  call_sid: string;
  to_number: string;
  from_number: string;
  agent_number: string;
  company_name: string | null;
  notes: string | null;
  status: string;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  recording_sid: string | null;
  recording_duration_seconds: number | null;
  transcript: string | null;
  transcript_segments: TranscriptSegment[] | null;
};

function normalizeTranscriptSegments(raw: unknown): TranscriptSegment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TranscriptSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    if (!text) continue;
    out.push({
      speaker: String(o.speaker ?? "Speaker").trim() || "Speaker",
      text,
      start: typeof o.start === "number" ? o.start : undefined,
      end: typeof o.end === "number" ? o.end : undefined,
    });
  }
  return out.length ? out : null;
}

function formatSegmentTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useSpeakerSegmentList(segs: TranscriptSegment[] | null): boolean {
  return Boolean(segs?.length && segs.some((s) => s.speaker !== "Transcript"));
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
  if (s === "failed" || s === "busy" || s === "no-answer") return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export default function CallsPage() {
  const [logs, setLogs] = useState<CallLogRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const transcribeInFlight = useRef(false);

  const [agentPhone, setAgentPhone] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async (opts?: { syncRecordings?: boolean; quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const callsUrl = opts?.syncRecordings ? "/api/calls?syncRecordings=1" : "/api/calls";
      const [logRes, recruiterRes] = await Promise.all([
        fetch(callsUrl),
        fetch("/api/recruiters"),
      ]);
      const logJson = (await logRes.json()) as { logs?: CallLogRow[]; error?: string };
      const recruiterJson = (await recruiterRes.json()) as {
        recruiters?: RecruiterRow[];
        error?: string;
      };

      if (!logRes.ok) throw new Error(logJson.error || "Failed to load call logs");
      if (!recruiterRes.ok) throw new Error(recruiterJson.error || "Failed to load recruiters");
      const rawLogs = logJson.logs || [];
      setLogs(
        rawLogs.map((row) => ({
          ...row,
          transcript_segments: normalizeTranscriptSegments(row.transcript_segments),
        }))
      );
      setRecruiters(recruiterJson.recruiters || []);
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const transcribeCallLog = useCallback(async (callLogId: string) => {
    if (transcribeInFlight.current) return;
    transcribeInFlight.current = true;
    setTranscribingId(callLogId);
    setError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 150_000);
    try {
      const res = await fetch("/api/calls/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId }),
        signal: controller.signal,
      });
      const body = (await res.json()) as {
        error?: string;
        transcript?: string;
        transcript_segments?: unknown;
        skipped?: boolean;
      };
      if (!res.ok) throw new Error(body.error || "Transcription failed");
      const t =
        body.transcript !== undefined && body.transcript !== null ? String(body.transcript) : null;
      const segs = normalizeTranscriptSegments(body.transcript_segments);
      if (t !== null) {
        setLogs((prev) =>
          prev.map((x) =>
            x.id === callLogId ? { ...x, transcript: t, transcript_segments: segs } : x
          )
        );
      } else {
        await load({ quiet: true });
      }
    } catch (e) {
      const aborted =
        (e instanceof Error && e.name === "AbortError") ||
        (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError");
      if (aborted) {
        setError("Transcription timed out. Try again, or use a shorter recording.");
      } else {
        setError(clientFetchFailedMessage(e));
      }
    } finally {
      window.clearTimeout(timer);
      transcribeInFlight.current = false;
      setTranscribingId(null);
    }
  }, [load]);

  async function placeCall() {
    if (!agentPhone.trim() || !toPhone.trim()) return;
    setCalling(true);
    setError(null);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toPhone.trim(),
          agentPhone: agentPhone.trim(),
          companyName: companyName.trim(),
          notes: notes.trim(),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to start call");
      await load();
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Calls
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Place recruiter calls with Twilio, track call logs, play recordings, and transcribe (Twilio first when
            possible; OpenAI is used automatically if Twilio cannot transcribe this recording type). Refresh syncs
            recording links from Twilio.
          </p>
        </div>
        <button type="button" onClick={() => void load({ syncRecordings: true })} className="btn-ghost">
          <IconRefresh className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Make a Call
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="input-field"
            placeholder="Your phone (agent) e.g. +9198..."
            value={agentPhone}
            onChange={(e) => setAgentPhone(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="Recruiter phone (to) e.g. +1415..."
            value={toPhone}
            onChange={(e) => setToPhone(e.target.value)}
          />
          <input
            className="input-field md:col-span-2"
            list="recruiter-emails-for-calls"
            placeholder="Recruiter email (optional lookup)"
            onChange={(e) => {
              const selected = recruiters.find((r) => r.email === e.target.value);
              if (selected && !companyName) setCompanyName(selected.companyName);
            }}
          />
          <datalist id="recruiter-emails-for-calls">
            {recruiters.map((r) => (
              <option key={r.email} value={r.email}>
                {r.name} - {r.companyName}
              </option>
            ))}
          </datalist>
          <input
            className="input-field md:col-span-2"
            placeholder="Company name (optional)"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <textarea
            className="input-field resize-none md:col-span-2"
            rows={3}
            placeholder="Call notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <button type="button" onClick={() => void placeCall()} disabled={calling} className="btn-primary">
            <IconPhone className="h-4 w-4" /> {calling ? "Calling..." : "Start Call"}
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Call Logs
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading call logs...</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-zinc-500">No calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-2 py-2">Time</th>
                  <th className="px-2 py-2">To</th>
                  <th className="px-2 py-2">Agent</th>
                  <th className="px-2 py-2">Company</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Duration</th>
                  <th className="px-2 py-2">Recording</th>
                  <th className="px-2 py-2">Transcript</th>
                  <th className="px-2 py-2">SID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-2 py-2 text-zinc-700 dark:text-zinc-300">{formatDate(log.created_at)}</td>
                    <td className="px-2 py-2">{log.to_number}</td>
                    <td className="px-2 py-2">{log.agent_number}</td>
                    <td className="px-2 py-2">{log.company_name || "-"}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">{log.duration_seconds != null ? `${log.duration_seconds}s` : "-"}</td>
                    <td className="px-2 py-2 align-top">
                      {log.recording_sid ? (
                        <div className="max-w-[220px] space-y-1">
                          <audio
                            controls
                            preload="none"
                            className="h-8 w-full max-w-[200px]"
                            src={`/api/calls/recording/${encodeURIComponent(log.recording_sid)}`}
                          >
                            Recording
                          </audio>
                          {log.recording_duration_seconds != null ? (
                            <span className="block text-xs text-zinc-500">
                              {log.recording_duration_seconds}s audio
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="max-w-[min(420px,44vw)] px-2 py-2 align-top text-xs text-zinc-700 dark:text-zinc-300">
                      {log.transcript !== null ? (
                        <div className="max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                          {useSpeakerSegmentList(log.transcript_segments) && log.transcript_segments ? (
                            <ul className="space-y-2">
                              {log.transcript_segments.map((seg, idx) => (
                                <li key={`${log.id}-seg-${idx}`} className="border-b border-zinc-200/80 pb-2 last:border-0 last:pb-0 dark:border-zinc-700/80">
                                  <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                                    <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                                      {seg.speaker}
                                    </span>
                                    {typeof seg.start === "number" ? (
                                      <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                                        {formatSegmentTime(seg.start)}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="whitespace-pre-wrap pl-0.5 text-zinc-800 dark:text-zinc-200">
                                    {seg.text}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          ) : log.transcript.length > 0 ? (
                            <p className="whitespace-pre-wrap">{log.transcript}</p>
                          ) : (
                            <span className="italic text-zinc-500">No speech detected.</span>
                          )}
                        </div>
                      ) : log.recording_sid ? (
                        <div className="flex flex-col gap-1">
                          {transcribingId === log.id ? (
                            <span className="text-zinc-500">Transcribing…</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost w-fit text-xs"
                              onClick={() => void transcribeCallLog(log.id)}
                              disabled={transcribingId !== null}
                            >
                              Transcribe
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{log.call_sid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
