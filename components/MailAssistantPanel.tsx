"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  MAIL_ASSISTANT_MODELS,
  DEFAULT_MAIL_ASSISTANT_MODEL,
  type MailAssistantModelId,
} from "@/lib/mail-assistant/models";
import type { MailSource } from "@/lib/mail-assistant/tools";

type Usage = { inputTokens: number; outputTokens: number; costUsd: number };
type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  sources?: MailSource[];
  usage?: Usage;
};

type Citation = { n: number; source: MailSource };
type RenderOpts = {
  citations: Map<string, Citation>;
  onOpenEmail?: (source: MailSource) => void;
};

/** Builds id → numbered citation in order of first appearance in the answer text. */
function buildCitations(content: string, sources: MailSource[]): Map<string, Citation> {
  const byId = new Map(sources.map((s) => [s.id, s] as const));
  const citations = new Map<string, Citation>();
  const re = /\[\[msg:([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(content))) {
    const id = m[1];
    if (citations.has(id)) continue;
    const source = byId.get(id) ?? { id };
    citations.set(id, { n: ++n, source });
  }
  return citations;
}

function CitationBadge({ citation, onOpenEmail }: { citation: Citation; onOpenEmail?: (s: MailSource) => void }) {
  const { n, source } = citation;
  const clickable = Boolean(source.threadId && onOpenEmail);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onOpenEmail?.(source)}
      title={source.subject ? `${source.subject}${source.from ? ` — ${source.from}` : ""}` : "Open email"}
      className={
        "mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-super text-[10px] font-semibold " +
        (clickable
          ? "cursor-pointer bg-[var(--color-primary,#2563eb)]/15 text-[var(--color-primary,#2563eb)] hover:bg-[var(--color-primary,#2563eb)]/30"
          : "bg-[var(--color-bg,#e5e7eb)] text-[var(--color-text-muted,#6b7280)]")
      }
    >
      {n}
    </button>
  );
}

/** Inline **bold** + [[msg:id]] citations → React nodes. Safe (no HTML injection). */
function renderInline(text: string, opts: RenderOpts): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[msg:[^\]]+\]\])/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    const cite = p.match(/^\[\[msg:([^\]]+)\]\]$/);
    if (cite) {
      const c = opts.citations.get(cite[1]);
      return c ? <CitationBadge key={i} citation={c} onOpenEmail={opts.onOpenEmail} /> : null;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/**
 * Tiny Markdown renderer for assistant replies — handles paragraphs, "-"/"*"
 * bullet lists, "1." numbered lists, **bold**, and [[msg:id]] citations. Avoids
 * pulling in a library and never injects raw HTML.
 */
function Markdown({ text, opts }: { text: string; opts: RenderOpts }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it, opts)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="my-1 list-decimal space-y-0.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="my-1 leading-snug">
          {renderInline(line, opts)}
        </p>
      );
    }
  }
  flushList();

  return <div className="text-sm">{blocks}</div>;
}

function formatCost(usd: number): string {
  // Email queries are cheap fractions of a cent — show enough precision.
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

/**
 * Floating "Ask your mail" assistant. Self-contained widget (fixed position),
 * so it can be dropped anywhere in the tree. Talks to POST /api/mail-assistant
 * and reads the NDJSON event stream (tool_call → answer → done).
 */
export function MailAssistantPanel({
  onOpenEmail,
}: {
  /** Open the thread for a cited email in the host app (inbox). */
  onOpenEmail?: (source: MailSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<MailAssistantModelId>(DEFAULT_MAIL_ASSISTANT_MODEL);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function send() {
    const question = input.trim();
    if (!question || busy) return;

    const history = turns;
    setTurns((t) => [...t, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    setStatus("Thinking…");
    scrollToBottom();

    try {
      const res = await fetch("/api/mail-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, model, history }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      // Read NDJSON line-by-line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let sources: MailSource[] = [];
      let usage: Usage | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as Record<string, unknown>;
          if (evt.type === "tool_call") {
            const name = String(evt.name);
            setStatus(
              name === "search_emails" ? "Searching your mailbox…" : "Reading an email…"
            );
          } else if (evt.type === "sources") {
            sources = Array.isArray(evt.sources) ? (evt.sources as MailSource[]) : [];
          } else if (evt.type === "answer") {
            answer = String(evt.content ?? "");
          } else if (evt.type === "done") {
            usage = evt.usage as Usage | undefined;
          } else if (evt.type === "error") {
            throw new Error(String(evt.error));
          }
        }
      }

      setTurns((t) => [
        ...t,
        { role: "assistant", content: answer || "(no answer)", sources, usage },
      ]);
      setStatus(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setTurns((t) => [...t, { role: "assistant", content: `⚠️ ${message}` }]);
      setStatus(null);
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[var(--color-primary,#2563eb)] px-4 py-3 text-sm font-medium text-white shadow-lg hover:opacity-90"
        title="Ask your mail"
      >
        <span aria-hidden>✨</span> Ask your mail
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#fff)] text-[var(--color-text,#111)] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border,#e5e7eb)] px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden>✨</span> Ask your mail
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as MailAssistantModelId)}
            disabled={busy}
            className="rounded-md border border-[var(--color-border,#e5e7eb)] bg-transparent px-1.5 py-1 text-xs"
            title="Model"
          >
            {MAIL_ASSISTANT_MODELS.map((m) => (
              <option key={m.id} value={m.id} title={m.hint}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-[var(--color-text-muted,#6b7280)] hover:bg-[var(--color-bg,#f3f4f6)]"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="text-xs text-[var(--color-text-muted,#6b7280)]">
            Ask anything about your mailbox, e.g.
            <ul className="mt-1 list-disc pl-4">
              <li>Summarize emails from Acme this month</li>
              <li>Any unread invoices in the last week?</li>
              <li>What did Priya say about the demo?</li>
            </ul>
          </div>
        )}
        {turns.map((t, i) => {
          const citations =
            t.role === "assistant"
              ? buildCitations(t.content, t.sources ?? [])
              : null;
          return (
            <div
              key={i}
              className={t.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}
            >
              <div
                className={
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm " +
                  (t.role === "user"
                    ? "whitespace-pre-wrap bg-[var(--color-primary,#2563eb)] text-white"
                    : "bg-[var(--color-bg,#f3f4f6)] text-[var(--color-text,#111)]")
                }
              >
                {t.role === "user" ? (
                  t.content
                ) : (
                  <Markdown text={t.content} opts={{ citations: citations!, onOpenEmail }} />
                )}
              </div>
              {/* Dev-only cost readout — remove before shipping. */}
              {t.role === "assistant" && t.usage && (
                <div className="mt-0.5 px-1 text-[10px] text-[var(--color-text-muted,#6b7280)]">
                  {formatCost(t.usage.costUsd)} · {t.usage.inputTokens.toLocaleString()} in /{" "}
                  {t.usage.outputTokens.toLocaleString()} out
                </div>
              )}
            </div>
          );
        })}
        {status && (
          <div className="text-xs italic text-[var(--color-text-muted,#6b7280)]">{status}</div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--color-border,#e5e7eb)] p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Ask about your mail…"
            disabled={busy}
            className="max-h-28 flex-1 resize-none rounded-lg border border-[var(--color-border,#e5e7eb)] bg-transparent px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-[var(--color-primary,#2563eb)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
