"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { IconPhone, IconRefresh } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

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

function hasSpeakerSegmentList(segs: TranscriptSegment[] | null): boolean {
  return Boolean(segs?.length && segs.some((s) => s.speaker !== "Transcript"));
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed")
    return "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-800/60";
  if (s === "failed" || s === "busy" || s === "no-answer")
    return "bg-red-100 text-red-800 ring-1 ring-red-200/80 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50";
  return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700";
}

function formatStatusLabel(status: string): string {
  return titleCase(status.replace(/-/g, " "));
}

function EmptyDashCell() {
  return (
    <span className="text-xs font-medium tabular-nums text-zinc-400 dark:text-zinc-500">{titleCase("N/A")}</span>
  );
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
        setError(
          titleCase("Transcription timed out. Try again, or use a shorter recording.")
        );
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
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {titleCase("Calls")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {titleCase("Place outbound calls and review recordings.")}
          </p>
        </div>
        <button type="button" onClick={() => void load({ syncRecordings: true })} className="btn-secondary shrink-0">
          <IconRefresh className="h-4 w-4" /> {titleCase("Refresh")}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <section className="card border-[#E5E7EB] p-8 dark:border-zinc-800">
        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
            {titleCase("Make a call")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {titleCase("Agent and callee numbers, optional recruiter context.")}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
            <input
              className="input-field"
              placeholder={titleCase("Your phone (agent) e.g. +9198...")}
              value={agentPhone}
              onChange={(e) => setAgentPhone(e.target.value)}
              aria-label={titleCase("Agent phone")}
            />
            <input
              className="input-field"
              placeholder={titleCase("Recruiter phone (to) e.g. +1415...")}
              value={toPhone}
              onChange={(e) => setToPhone(e.target.value)}
              aria-label={titleCase("Callee phone")}
            />
          </div>
          <input
            className="input-field md:col-span-2"
            list="recruiter-emails-for-calls"
            placeholder={titleCase("Recruiter email (optional lookup)")}
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
            placeholder={titleCase("Company name (optional)")}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <textarea
            className="input-field resize-none md:col-span-2"
            rows={3}
            placeholder={titleCase("Call notes (optional)")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void placeCall()}
            disabled={calling}
            className="btn-primary gap-2 px-6 text-[15px] font-bold"
          >
            <IconPhone className="h-5 w-5 opacity-95" />
            {calling ? titleCase("Calling…") : titleCase("Start call")}
          </button>
        </div>
      </section>

      <section className="card border-[#E5E7EB] p-8 dark:border-zinc-800">
        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
            {titleCase("Call logs")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {titleCase("History, recordings, and transcripts.")}
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-zinc-500">{titleCase("Loading call logs...")}</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-zinc-500">{titleCase("No calls yet.")}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto rounded-lg border border-zinc-200/90 dark:border-zinc-800">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/95 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Time")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("To")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Agent")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Company")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Status")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Duration")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Recording")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("Transcript")}
                  </th>
                  <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {titleCase("SID")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800/80 dark:bg-zinc-950/20">
                {logs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
                    <td className="whitespace-nowrap px-4 py-4 text-zinc-700 dark:text-zinc-300">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-4 font-medium text-zinc-900 dark:text-zinc-100">{log.to_number}</td>
                    <td className="px-4 py-4 text-zinc-700 dark:text-zinc-300">{log.agent_number}</td>
                    <td className="px-4 py-4 text-zinc-700 dark:text-zinc-300">
                      {log.company_name?.trim() ? log.company_name : <EmptyDashCell />}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(log.status)}`}
                      >
                        {formatStatusLabel(log.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {log.duration_seconds != null ? `${log.duration_seconds}s` : <EmptyDashCell />}
                    </td>
                    <td className="px-4 py-4 align-top">
                      {log.recording_sid ? (
                        <div className="max-w-[220px] space-y-1">
                          <audio
                            controls
                            preload="none"
                            className="h-8 w-full max-w-[200px]"
                            src={`/api/calls/recording/${encodeURIComponent(log.recording_sid)}`}
                          >
                            {titleCase("Recording")}
                          </audio>
                          {log.recording_duration_seconds != null ? (
                            <span className="block text-xs text-zinc-500">
                              {log.recording_duration_seconds}s audio
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          <IconPhone className="h-3.5 w-3.5 opacity-50" />
                          {titleCase("N/A")}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[min(420px,44vw)] px-4 py-4 align-top text-xs text-zinc-700 dark:text-zinc-300">
                      {log.transcript !== null ? (
                        <div className="max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                          {hasSpeakerSegmentList(log.transcript_segments) && log.transcript_segments ? (
                            <ul className="space-y-2">
                              {log.transcript_segments.map((seg, idx) => (
                                <li
                                  key={`${log.id}-seg-${idx}`}
                                  className="border-b border-zinc-200/80 pb-2 last:border-0 last:pb-0 dark:border-zinc-700/80"
                                >
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
                            <span className="italic text-zinc-500">{titleCase("No speech detected.")}</span>
                          )}
                        </div>
                      ) : log.recording_sid ? (
                        <div className="flex flex-col gap-1">
                          {transcribingId === log.id ? (
                            <span className="text-zinc-500">{titleCase("Transcribing…")}</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost w-fit text-xs"
                              onClick={() => void transcribeCallLog(log.id)}
                              disabled={transcribingId !== null}
                            >
                              {titleCase("Transcribe")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          <IconPhone className="h-3.5 w-3.5 opacity-50" />
                          {titleCase("N/A")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">{log.call_sid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
