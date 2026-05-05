"use client";

import { useCallback, useRef, useState } from "react";
import { IconBroadcast, IconPlus, IconSend, IconX } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { normalizePhoneList } from "@/lib/broadcast-phones";

export function WhatsAppBroadcastPanel() {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { phone: string; error: string }[];
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const mergeRecipients = useCallback((more: string[]) => {
    setRecipients((prev) => Array.from(new Set([...prev, ...more])));
  }, []);

  const applyManual = useCallback(() => {
    const next = normalizePhoneList(manualInput);
    if (next.length) mergeRecipients(next);
    setManualInput("");
  }, [manualInput, mergeRecipients]);

  const onPickFile = async (list: FileList | null) => {
    if (!list?.length) return;
    const file = list[0];
    setParseError(null);
    setParseBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/broadcast/parse-phones", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; phones?: string[] };
      if (!res.ok) throw new Error(data.error || "Import failed");
      const phones = data.phones || [];
      if (phones.length === 0) {
        setParseError(
          "No phone numbers found. Use a column named Phone, Mobile, or Tel, or include +country numbers in the sheet.",
        );
      } else {
        mergeRecipients(phones);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setParseBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sendBroadcast = async () => {
    setSendError(null);
    setSendResult(null);
    if (recipients.length === 0) {
      setSendError("Add recipients from a file or the manual list.");
      return;
    }
    if (!body.trim()) {
      setSendError("Enter the message to send.");
      return;
    }
    setSendBusy(true);
    try {
      const res = await fetch("/api/broadcast/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, text: body.trim() }),
      });
      const data = (await res.json()) as {
        error?: string;
        sent?: number;
        failed?: { phone: string; error: string }[];
      };
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSendResult({
        sent: data.sent ?? 0,
        failed: data.failed ?? [],
      });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="card space-y-6 p-5 sm:p-6">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
        <IconBroadcast className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
        <p>
          {titleCase(
            "Each number gets the same session message via Twilio (not a group chat). Max 50 per batch. Trial sandbox: only numbers that joined your sandbox receive messages; use approved templates for cold outreach.",
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titleCase("Recipients")}</h2>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Import CSV or Excel")}
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.ods"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files)}
            />
            <button
              type="button"
              disabled={parseBusy}
              onClick={() => fileRef.current?.click()}
              className="btn-secondary w-full justify-center sm:w-auto"
            >
              {parseBusy ? titleCase("Reading…") : titleCase("Choose file")}
            </button>
            {parseError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p> : null}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Or paste numbers (comma, newline; E.164 +country)")}
            </label>
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              rows={4}
              className="input-field resize-none text-sm"
              placeholder="+14155552671, +447700900123"
            />
            <button type="button" onClick={applyManual} className="btn-ghost mt-2 gap-1 text-sm">
              <IconPlus className="h-4 w-4" />
              {titleCase("Add to list")}
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">
              {titleCase("List")} ({recipients.length})
            </p>
            {recipients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
                {titleCase("No recipients yet")}
              </p>
            ) : (
              <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                {recipients.map((phone) => (
                  <li
                    key={phone}
                    className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs dark:bg-zinc-950"
                  >
                    <span className="truncate font-mono text-zinc-800 dark:text-zinc-200">{phone}</span>
                    <button
                      type="button"
                      onClick={() => setRecipients((r) => r.filter((x) => x !== phone))}
                      className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={titleCase("Remove")}
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {recipients.length > 0 ? (
              <button
                type="button"
                onClick={() => setRecipients([])}
                className="btn-ghost mt-2 text-xs text-red-600 dark:text-red-400"
              >
                {titleCase("Clear all")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titleCase("Message")}</h2>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">
              {titleCase("Text to all recipients")}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="input-field resize-y text-sm"
              placeholder={titleCase("Same session message sent to each number individually…")}
            />
          </div>
        </div>
      </div>

      {sendError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {sendError}
        </div>
      ) : null}
      {sendResult ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <p className="font-medium">
            {titleCase(`Sent: ${sendResult.sent}`)}
            {sendResult.failed.length > 0 ? ` · ${titleCase(`Failed: ${sendResult.failed.length}`)}` : ""}
          </p>
          {sendResult.failed.length > 0 ? (
            <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs">
              {sendResult.failed.map((f) => (
                <li key={f.phone}>
                  <span className="font-mono">{f.phone}</span>: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          disabled={sendBusy || recipients.length === 0 || !body.trim()}
          onClick={() => void sendBroadcast()}
          className="btn-primary min-w-[160px] justify-center"
        >
          {sendBusy ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {titleCase("Sending…")}
            </>
          ) : (
            <>
              <IconSend className="h-4 w-4" />
              {titleCase("Send WhatsApp broadcast")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
