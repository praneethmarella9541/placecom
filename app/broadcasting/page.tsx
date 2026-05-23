"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { normalizeEmailList } from "@/lib/broadcast-recipients";
import {
  IconBroadcast,
  IconMail,
  IconSend,
  IconPaperclip,
  IconX,
  IconPlus,
  IconMessageChat,
  IconSms,
} from "@/components/Icons";
import { WhatsAppMessaging } from "@/components/WhatsAppMessaging";
import { WhatsAppBroadcastPanel } from "@/components/WhatsAppBroadcastPanel";
import { SmsBroadcastPanel } from "@/components/SmsBroadcastPanel";
import { SmsMessaging } from "@/components/SmsMessaging";
import { MailMergePanel } from "@/components/MailMergePanel";

type Channel = "mail" | "sms" | "whatsapp";
type MailSubView = "broadcast" | "merge";
type WhatsAppSubView = "broadcast" | "chats";
type SmsSubView = "broadcast" | "chats";

type PendingFile = { file: File; base64: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BroadcastingPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [channel, setChannelState] = useState<Channel>("mail");

  useEffect(() => {
    const c = searchParams.get("channel");
    if (c === "whatsapp" || c === "sms" || c === "mail") setChannelState(c);
    else setChannelState("mail");
  }, [searchParams]);

  function selectChannel(next: Channel) {
    setChannelState(next);
    router.replace(`${pathname}?channel=${next}`, { scroll: false });
  }

  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const attachRef = useRef<HTMLInputElement>(null);

  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { email: string; error: string }[];
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [mailSubView, setMailSubView] = useState<MailSubView>("broadcast");
  const [whatsappSubView, setWhatsappSubView] = useState<WhatsAppSubView>("broadcast");
  const [smsSubView, setSmsSubView] = useState<SmsSubView>("chats");

  const mergeRecipients = useCallback((more: string[]) => {
    setRecipients((prev) => Array.from(new Set([...prev, ...more])));
  }, []);

  const applyManual = useCallback(() => {
    const next = normalizeEmailList(manualInput);
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
      const res = await fetch("/api/broadcast/parse-emails", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; emails?: string[] };
      if (!res.ok) throw new Error(data.error || "Import failed");
      const emails = data.emails || [];
      if (emails.length === 0) {
        setParseError(
          "No email addresses found. Use a column named Email, or put one address per cell in the first column."
        );
      } else {
        mergeRecipients(emails);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setParseBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onAttach = async (list: FileList | null) => {
    if (!list) return;
    const next: PendingFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (file.size > 24 * 1024 * 1024) {
        alert(`${file.name} is too large (max 24 MB per file)`);
        continue;
      }
      const base64 = await fileToBase64(file);
      next.push({ file, base64 });
    }
    if (next.length) setAttachments((p) => [...p, ...next]);
    if (attachRef.current) attachRef.current.value = "";
  };

  const sendBroadcast = async () => {
    setSendError(null);
    setSendResult(null);
    if (recipients.length === 0) {
      setSendError("Add recipients from a file or the manual list.");
      return;
    }
    setSendBusy(true);
    try {
      const att = attachments.map((a) => ({
        filename: a.file.name,
        mimeType: a.file.type || "application/octet-stream",
        base64Data: a.base64,
      }));
      const res = await fetch("/api/broadcast/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          subject: subject.trim(),
          textBody: body,
          attachments: att.length ? att : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        sent?: number;
        failed?: { email: string; error: string }[];
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
    <div className={cn("mx-auto space-y-6", channel === "whatsapp" || channel === "sms" ? "max-w-5xl" : "max-w-4xl")}>
      {channel !== "whatsapp" ? (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {titleCase("Broadcasting")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {titleCase("Reach candidates by mail, SMS (Twilio), or WhatsApp — use the tabs below.")}
            </p>
          </div>

          <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/80">
            {(
              [
                { key: "mail" as const, label: "Mail", icon: IconMail },
                { key: "sms" as const, label: "SMS", icon: IconSms },
                { key: "whatsapp" as const, label: "WhatsApp", icon: IconMessageChat },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectChannel(tab.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    channel === tab.key
                      ? "bg-white text-emerald-700 shadow-sm dark:bg-zinc-950 dark:text-emerald-400"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {titleCase(tab.label)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {channel === "mail" ? (
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60">
            {(
              [
                { key: "broadcast" as const, label: "Broadcast" },
                { key: "merge" as const, label: "Mail merge" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMailSubView(tab.key)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  mailSubView === tab.key
                    ? "bg-white text-emerald-700 shadow-sm dark:bg-zinc-950 dark:text-emerald-400"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                )}
              >
                {titleCase(tab.label)}
              </button>
            ))}
          </div>

          {mailSubView === "merge" ? (
            <MailMergePanel />
          ) : (
        <div className="card space-y-6 p-5 sm:p-6">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
            <IconBroadcast className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <p>
              {titleCase(
                "Each recipient gets their own email (not visible to others). Uses your connected Gmail. Max 80 recipients per batch."
              )}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {titleCase("Recipients")}
              </h2>

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
                {parseError ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p>
                ) : null}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  {titleCase("Or paste addresses (comma, space, or one per line)")}
                </label>
                <textarea
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  rows={4}
                  className="input-field resize-none text-sm"
                  placeholder="a@example.com, b@example.com"
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
                  <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                    {recipients.map((email) => (
                      <li
                        key={email}
                        className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs dark:bg-zinc-950"
                      >
                        <span className="truncate font-mono text-zinc-800 dark:text-zinc-200">{email}</span>
                        <button
                          type="button"
                          onClick={() => setRecipients((r) => r.filter((x) => x !== email))}
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
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {titleCase("Message")}
              </h2>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  {titleCase("Subject")}
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="input-field"
                  placeholder={titleCase("e.g. Placement update")}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  {titleCase("Body")}
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="input-field resize-y text-sm"
                  placeholder={titleCase("Write the message…")}
                />
              </div>
              <div>
                <input
                  ref={attachRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onAttach(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => attachRef.current?.click()}
                  className="btn-ghost gap-1.5 text-sm"
                >
                  <IconPaperclip className="h-4 w-4" />
                  {titleCase("Add attachments")}
                </button>
                {attachments.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {attachments.map((a, i) => (
                      <li
                        key={`${a.file.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs dark:bg-zinc-800"
                      >
                        <span className="truncate">
                          {a.file.name}{" "}
                          <span className="text-zinc-400">({formatBytes(a.file.size)})</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                          className="text-zinc-400 hover:text-red-500"
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
                {sendResult.failed.length > 0
                  ? ` · ${titleCase(`Failed: ${sendResult.failed.length}`)}`
                  : ""}
              </p>
              {sendResult.failed.length > 0 ? (
                <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs">
                  {sendResult.failed.map((f) => (
                    <li key={f.email}>
                      <span className="font-mono">{f.email}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <button
              type="button"
              disabled={sendBusy || recipients.length === 0}
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
                  {titleCase("Send broadcast")}
                </>
              )}
            </button>
          </div>
        </div>
          )}
        </div>
      ) : channel === "sms" ? (
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60">
            {(
              [
                { key: "chats" as const, label: "Chats" },
                { key: "broadcast" as const, label: "Broadcast" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSmsSubView(tab.key)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  smsSubView === tab.key
                    ? "bg-white text-sky-700 shadow-sm dark:bg-zinc-950 dark:text-sky-400"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                )}
              >
                {titleCase(tab.label)}
              </button>
            ))}
          </div>
          {smsSubView === "broadcast" ? <SmsBroadcastPanel /> : <SmsMessaging embedded />}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60">
            {(
              [
                { key: "broadcast" as const, label: "Broadcast" },
                { key: "chats" as const, label: "Chats" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setWhatsappSubView(tab.key)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  whatsappSubView === tab.key
                    ? "bg-white text-emerald-700 shadow-sm dark:bg-zinc-950 dark:text-emerald-400"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                )}
              >
                {titleCase(tab.label)}
              </button>
            ))}
          </div>
          {whatsappSubView === "broadcast" ? <WhatsAppBroadcastPanel /> : <WhatsAppMessaging embedded />}
        </div>
      )}
    </div>
  );
}

export default function BroadcastingPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase("Loading…")}
        </div>
      }
    >
      <BroadcastingPageInner />
    </Suspense>
  );
}
