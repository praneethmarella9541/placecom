import "server-only";

import { toFile } from "openai";
import OpenAI from "openai";
import twilio from "twilio";

const RE_SID = /^RE[0-9a-f]{32}$/i;
const MAX_BYTES = 24 * 1024 * 1024;

export type TwilioRestClient = ReturnType<typeof twilio>;

export type CallTranscriptionSource = "twilio" | "openai";

/** One turn (stored in `call_logs.transcript_segments`). */
export type CallTranscriptSegment = {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
};

export function formatTranscriptFromSegments(segments: CallTranscriptSegment[]): string {
  if (!segments.length) return "";
  return segments
    .map((s) => {
      const line = s.text.trim();
      if (!line) return "";
      return `[${s.speaker}] ${line}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function getCallTranscriptionProvider(): "twilio" | "openai" | "auto" {
  const v = process.env.CALL_TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (v === "twilio" || v === "openai" || v === "auto") return v;
  return "auto";
}

function maxRecordingSecondsForTwilio(): number {
  const raw = process.env.TWILIO_RECORDING_TRANSCRIPTION_MAX_SECONDS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120;
  if (!Number.isFinite(n)) return 120;
  return Math.min(600, Math.max(30, n));
}

function pollIntervalMs(): number {
  const raw = process.env.TWILIO_TRANSCRIPTION_POLL_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 2000;
  if (!Number.isFinite(n)) return 2000;
  return Math.min(10_000, Math.max(1000, n));
}

function maxPollWaitMs(): number {
  const raw = process.env.TWILIO_TRANSCRIPTION_MAX_WAIT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120_000;
  if (!Number.isFinite(n)) return 120_000;
  return Math.min(180_000, Math.max(30_000, n));
}

function transcriptionLanguage(): string | undefined {
  const v = process.env.TWILIO_TRANSCRIPTION_LANGUAGE?.trim();
  return v || undefined;
}

function openaiTranscriptionModel(): string {
  const m = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim();
  return m || "gpt-4o-mini-transcribe";
}

function openaiTranscriptionTimeoutMs(): number {
  const raw = process.env.OPENAI_TRANSCRIPTION_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120_000;
  if (!Number.isFinite(n)) return 120_000;
  return Math.min(180_000, Math.max(60_000, n));
}

function parseRecordingDurationSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchTwilioRecordingMp3(recordingSid: string): Promise<Buffer> {
  if (!RE_SID.test(recordingSid)) {
    throw new Error("Invalid recording SID");
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !token) {
    throw new Error("Twilio is not configured");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  const basic = Buffer.from(`${accountSid}:${token}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) {
    throw new Error(`Twilio recording fetch failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("Recording is too large to transcribe (max ~24MB)");
  }
  if (buf.byteLength === 0) {
    throw new Error("Recording file is empty");
  }
  return buf;
}

async function createRecordingTranscriptionViaRest(
  accountSid: string,
  authToken: string,
  recordingSid: string,
): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}/Transcriptions.json`;
  const body = new URLSearchParams();
  const lang = transcriptionLanguage();
  if (lang) body.set("Language", lang);
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Twilio transcription request failed (${res.status}): ${text.slice(0, 800)}`);
  }
  let json: { sid?: string };
  try {
    json = JSON.parse(text) as { sid?: string };
  } catch {
    throw new Error("Twilio returned invalid JSON for transcription create");
  }
  if (!json.sid) {
    throw new Error("Twilio did not return a transcription SID");
  }
  return json.sid;
}

async function waitForTranscriptionText(
  client: TwilioRestClient,
  transcriptionSid: string,
): Promise<string> {
  const deadline = Date.now() + maxPollWaitMs();
  const interval = pollIntervalMs();
  const account = client.api.v2010.account;

  while (Date.now() < deadline) {
    const t = await account.transcriptions(transcriptionSid).fetch();
    if (t.status === "completed") {
      return String(t.transcriptionText ?? "").trim();
    }
    if (t.status === "failed") {
      throw new Error("Twilio transcription failed for this recording");
    }
    await sleep(interval);
  }
  throw new Error("Twilio transcription timed out. Try again in a moment.");
}

function segmentsFromPlainText(text: string): { segments: CallTranscriptSegment[]; transcriptPlain: string } {
  const transcriptPlain = text.trim();
  if (!transcriptPlain) {
    return { segments: [], transcriptPlain: "" };
  }
  return {
    segments: [{ speaker: "Transcript", text: transcriptPlain }],
    transcriptPlain,
  };
}

function assertTwilioTranscriptNonEmpty(
  result: { segments: CallTranscriptSegment[]; transcriptPlain: string },
): void {
  if (!result.transcriptPlain) {
    throw new Error("Twilio returned an empty transcript for this recording.");
  }
}

/**
 * Twilio classic Recording Transcription. Officially aimed at TwiML Record verb captures (about two minutes max);
 * REST dial recordings (record: true) are often rejected or return empty — prefer {@link transcribeCallRecording} for automatic OpenAI fallback.
 */
export async function transcribeCallRecordingTwilio(
  client: TwilioRestClient,
  recordingSid: string,
): Promise<{ segments: CallTranscriptSegment[]; transcriptPlain: string }> {
  if (!RE_SID.test(recordingSid)) {
    throw new Error("Invalid recording SID");
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    throw new Error("Twilio is not configured");
  }

  const account = client.api.v2010.account;
  const recording = await account.recordings(recordingSid).fetch();
  const durationSec = parseRecordingDurationSeconds(recording.duration);
  const maxSec = maxRecordingSecondsForTwilio();

  if (durationSec === 0) {
    throw new Error(
      "Recording has zero duration in Twilio yet. Wait for processing, use Refresh on the calls list, then transcribe again.",
    );
  }
  if (durationSec !== null && durationSec > maxSec) {
    throw new Error(
      `Recording is ${Math.ceil(durationSec)}s; Twilio transcription is limited to about ${maxSec}s for this project. Trim the call or use a shorter recording.`,
    );
  }

  const subs = account.recordings(recordingSid).transcriptions;
  const existing = await subs.list({ limit: 20 });
  for (const row of existing) {
    if (row.status === "completed") {
      const text = String(row.transcriptionText ?? "").trim();
      if (text) {
        const result = segmentsFromPlainText(text);
        assertTwilioTranscriptNonEmpty(result);
        return result;
      }
    }
  }

  for (const row of existing) {
    if (row.status === "in-progress") {
      const text = await waitForTranscriptionText(client, row.sid);
      const result = segmentsFromPlainText(text);
      assertTwilioTranscriptNonEmpty(result);
      return result;
    }
  }

  const trSid = await createRecordingTranscriptionViaRest(accountSid, authToken, recordingSid);
  const text = await waitForTranscriptionText(client, trSid);
  const result = segmentsFromPlainText(text);
  assertTwilioTranscriptNonEmpty(result);
  return result;
}

/** Transcribe downloaded MP3 with OpenAI (works for any Twilio call recording length within size limits). */
export async function transcribeCallRecordingOpenAI(mp3: Buffer): Promise<{
  segments: CallTranscriptSegment[];
  transcriptPlain: string;
}> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const timeoutMs = openaiTranscriptionTimeoutMs();
  const openai = new OpenAI({ apiKey: key, timeout: timeoutMs });
  const file = await toFile(mp3, "call.mp3", { type: "audio/mpeg" });
  const model = openaiTranscriptionModel();

  const result = await openai.audio.transcriptions.create({
    file,
    model,
    response_format: "json",
  });
  const obj = result as { text?: string };
  const text = String(obj.text ?? "").trim();
  return {
    segments: text ? [{ speaker: "Transcript", text }] : [],
    transcriptPlain: text,
  };
}

const TWILIO_UNSUPPORTED_HINT =
  "Twilio’s classic transcription API officially supports TwiML <Record> captures (short clips). Programmable Voice recordings from REST dial often cannot be transcribed by Twilio alone.";

function appendOpenaiFallbackHint(err: unknown): Error {
  const base = err instanceof Error ? err.message : String(err);
  if (process.env.OPENAI_API_KEY?.trim()) {
    return new Error(base);
  }
  return new Error(
    `${base} ${TWILIO_UNSUPPORTED_HINT} Set OPENAI_API_KEY to enable automatic OpenAI fallback (CALL_TRANSCRIPTION_PROVIDER=auto), or set CALL_TRANSCRIPTION_PROVIDER=openai.`,
  );
}

/**
 * Uses CALL_TRANSCRIPTION_PROVIDER: twilio | openai | auto (default).
 * Auto tries Twilio first, then OpenAI when Twilio fails or returns empty, if OPENAI_API_KEY is set.
 */
export async function transcribeCallRecording(
  twilioClient: TwilioRestClient,
  recordingSid: string,
): Promise<{
  segments: CallTranscriptSegment[];
  transcriptPlain: string;
  source: CallTranscriptionSource;
}> {
  const mode = getCallTranscriptionProvider();

  if (mode === "openai") {
    const mp3 = await fetchTwilioRecordingMp3(recordingSid);
    const r = await transcribeCallRecordingOpenAI(mp3);
    if (!r.transcriptPlain) {
      throw new Error("OpenAI returned an empty transcript for this recording.");
    }
    return { ...r, source: "openai" };
  }

  if (mode === "twilio") {
    const r = await transcribeCallRecordingTwilio(twilioClient, recordingSid);
    return { ...r, source: "twilio" };
  }

  // auto
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY?.trim());
  try {
    const r = await transcribeCallRecordingTwilio(twilioClient, recordingSid);
    return { ...r, source: "twilio" };
  } catch (e) {
    if (!hasOpenai) {
      throw appendOpenaiFallbackHint(e);
    }
    const mp3 = await fetchTwilioRecordingMp3(recordingSid);
    const r = await transcribeCallRecordingOpenAI(mp3);
    if (!r.transcriptPlain) {
      throw new Error("OpenAI returned an empty transcript for this recording.");
    }
    return { ...r, source: "openai" };
  }
}
