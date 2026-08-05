"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { normalizeEmailList } from "@/lib/broadcast-recipients";
import {
  IconMail,
  IconSend,
  IconPaperclip,
  IconX,
  IconPlus,
  IconMessageChat,
} from "@/components/Icons";
import { WhatsAppBroadcastPanel } from "@/components/WhatsAppBroadcastPanel";
import { MailMergePanel } from "@/components/MailMergePanel";

type Channel = "mail" | "whatsapp";
type MailSubView = "broadcast" | "merge";
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

/* ── Channel tab pill ──────────────────────────────────────── */
function ChannelTab({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-150",
        active
          ? "bg-[var(--color-surface)] text-[var(--color-copper)] shadow-[var(--shadow-sm)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
      )}
    >
      <Icon className="h-4 w-4" />
      {titleCase(label)}
    </button>
  );
}

/* ── Section label ─────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
      {children}
    </p>
  );
}

function BroadcastingPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [channel, setChannelState] = useState<Channel>("mail");

  useEffect(() => {
    const c = searchParams.get("channel");
    if (c === "whatsapp" || c === "mail") setChannelState(c);
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
      setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? [] });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className={cn("mx-auto space-y-5", channel === "whatsapp" ? "max-w-5xl" : "max-w-4xl")}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="animate-fade-up flex items-end justify-between" style={{ animationDuration: "0.3s" }}>
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Broadcasting")}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-faint)]">
            {titleCase("Reach your audience by mail or WhatsApp")}
          </p>
        </div>
      </div>

      {/* ── Channel tabs ─────────────────────────────────────── */}
      <div className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        <ChannelTab icon={IconMail}        label="Mail"      active={channel === "mail"}      onClick={() => selectChannel("mail")}      testId="broadcast-tab-mail" />
        <ChannelTab icon={IconMessageChat} label="WhatsApp"  active={channel === "whatsapp"}  onClick={() => selectChannel("whatsapp")} testId="broadcast-tab-whatsapp" />
      </div>

      {/* ── Mail channel ─────────────────────────────────────── */}
      {channel === "mail" ? (
        <div className="space-y-4">
          {/* Broadcast / Mail merge sub-tabs */}
          <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-0.5">
            {(["broadcast", "merge"] as const).map((key) => (
              <button
                key={key}
                data-testid={`broadcast-mail-subtab-${key}`}
                type="button"
                onClick={() => setMailSubView(key)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13px] font-medium transition-all duration-150",
                  mailSubView === key
                    ? "bg-[var(--color-surface)] text-[var(--color-copper)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                )}
              >
                {titleCase(key === "broadcast" ? "Broadcast" : "Mail merge")}
              </button>
            ))}
          </div>

          {mailSubView === "merge" ? (
            <MailMergePanel />
          ) : (
            <div className="surface-card rounded-2xl p-5 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-2">

                {/* ── Recipients ──────────────────────────────── */}
                <div className="space-y-4">
                  <SectionLabel>{titleCase("Recipients")}</SectionLabel>

                  {/* CSV import */}
                  <div>
                    <p className="mb-2 text-[12px] font-medium text-[var(--color-text-muted)]">
                      {titleCase("Import CSV or Excel")}
                    </p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls,.ods"
                      className="hidden"
                      onChange={(e) => void onPickFile(e.target.files)}
                    />
                    <button
                      data-testid="broadcast-import-csv-btn"
                      type="button"
                      disabled={parseBusy}
                      onClick={() => fileRef.current?.click()}
                      className="btn-secondary w-full justify-center sm:w-auto"
                    >
                      {parseBusy ? titleCase("Reading…") : titleCase("Choose file")}
                    </button>
                    {parseError && (
                      <p className="mt-2 text-[12px] text-[var(--color-danger)]">{parseError}</p>
                    )}
                  </div>

                  {/* Manual paste */}
                  <div>
                    <p className="mb-2 text-[12px] font-medium text-[var(--color-text-muted)]">
                      {titleCase("Or paste addresses")}
                    </p>
                    <textarea
                      data-testid="broadcast-manual-recipients-input"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      rows={4}
                      className="input-field resize-none text-[13px]"
                      placeholder="a@example.com, b@example.com"
                    />
                    <button
                      data-testid="broadcast-add-recipients-btn"
                      type="button"
                      onClick={applyManual}
                      className="btn-ghost mt-2 gap-1.5 text-[13px]"
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      {titleCase("Add to list")}
                    </button>
                  </div>

                  {/* Recipient list */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[12px] font-medium text-[var(--color-text-muted)]">
                        {titleCase("List")}
                        {recipients.length > 0 && (
                          <span className="ml-1.5 rounded-full bg-[var(--color-copper)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-copper)]">
                            {recipients.length}
                          </span>
                        )}
                      </p>
                      {recipients.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setRecipients([])}
                          className="text-[11px] font-medium text-[var(--color-danger)] hover:underline"
                        >
                          {titleCase("Clear all")}
                        </button>
                      )}
                    </div>
                    {recipients.length === 0 ? (
                      <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--color-border)] px-3 py-8 text-center">
                        <p className="text-[13px] text-[var(--color-text-faint)]">
                          {titleCase("No recipients yet")}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">
                          {titleCase("Import a file or paste addresses above")}
                        </p>
                      </div>
                    ) : (
                      <ul className="scrollbar-thin max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                        {recipients.map((email) => (
                          <li
                            key={email}
                            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-surface)] px-2.5 py-1.5"
                          >
                            <span className="truncate font-mono text-[12px] text-[var(--color-text)]">
                              {email}
                            </span>
                            <button
                              type="button"
                              onClick={() => setRecipients((r) => r.filter((x) => x !== email))}
                              className="shrink-0 rounded-md p-0.5 text-[var(--color-text-faint)] hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
                              aria-label={titleCase("Remove")}
                            >
                              <IconX className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* ── Message ─────────────────────────────────── */}
                <div className="space-y-4">
                  <SectionLabel>{titleCase("Message")}</SectionLabel>

                  <div>
                    <p className="mb-1.5 text-[12px] font-medium text-[var(--color-text-muted)]">
                      {titleCase("Subject")}
                    </p>
                    <input
                      data-testid="broadcast-subject-input"
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="input-field"
                      placeholder={titleCase("e.g. Placement update")}
                    />
                  </div>

                  <div>
                    <p className="mb-1.5 text-[12px] font-medium text-[var(--color-text-muted)]">
                      {titleCase("Body")}
                    </p>
                    <textarea
                      data-testid="broadcast-body-input"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={10}
                      className="input-field resize-y text-[13px]"
                      placeholder={titleCase("Write the message…")}
                    />
                  </div>

                  {/* Attachments */}
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
                      className="btn-ghost gap-1.5 text-[13px]"
                    >
                      <IconPaperclip className="h-3.5 w-3.5" />
                      {titleCase("Add attachments")}
                    </button>
                    {attachments.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {attachments.map((a, i) => (
                          <li
                            key={`${a.file.name}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2 text-[12px]"
                          >
                            <span className="truncate text-[var(--color-text)]">
                              {a.file.name}{" "}
                              <span className="text-[var(--color-text-faint)]">
                                ({formatBytes(a.file.size)})
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                              className="shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                            >
                              <IconX className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Status messages ──────────────────────────── */}
              {sendError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-[var(--color-danger)] dark:border-red-900/50 dark:bg-red-950/30">
                  {sendError}
                </div>
              )}
              {sendResult && (
                <div className="mt-4 rounded-xl border border-[var(--color-copper)]/30 bg-[var(--color-copper)]/10 px-4 py-3 text-[13px]">
                  <p className="font-semibold text-[var(--color-copper-hover)]">
                    {titleCase(`Sent: ${sendResult.sent}`)}
                    {sendResult.failed.length > 0 && (
                      <span className="ml-2 text-[var(--color-danger)]">
                        · {titleCase(`Failed: ${sendResult.failed.length}`)}
                      </span>
                    )}
                  </p>
                  {sendResult.failed.length > 0 && (
                    <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-[11px] text-[var(--color-text-muted)]">
                      {sendResult.failed.map((f) => (
                        <li key={f.email}>
                          <span className="font-mono">{f.email}</span>: {f.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* ── Send button ──────────────────────────────── */}
              <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border)] pt-4">
                <button
                  data-testid="broadcast-send-btn"
                  type="button"
                  disabled={sendBusy || recipients.length === 0}
                  onClick={() => void sendBroadcast()}
                  className="btn-primary-copper min-w-[160px] justify-center gap-2"
                >
                  {sendBusy ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {titleCase("Sending…")}
                    </>
                  ) : (
                    <>
                      <IconSend className="h-3.5 w-3.5" />
                      {titleCase("Send broadcast")}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="surface-card rounded-2xl p-5 sm:p-6">
          <WhatsAppBroadcastPanel />
        </div>
      )}
    </div>
  );
}

export default function BroadcastingPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-6 py-12 text-center text-[13px] text-[var(--color-text-faint)]">
          {titleCase("Loading…")}
        </div>
      }
    >
      <BroadcastingPageInner />
    </Suspense>
  );
}
