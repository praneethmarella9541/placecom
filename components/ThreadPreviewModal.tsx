"use client";

import { useEffect, useState } from "react";
import { IconX } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { EmailHtmlBody } from "@/components/EmailHtmlBody";

type ThreadMessage = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  bodyHtml: string;
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Lightweight read-only thread viewer for surfacing a single Gmail thread from
 * outside the main Inbox (e.g. the Companies CRM Emails tab). */
export function ThreadPreviewModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setError(null);
    fetch(`/api/gmail/threads/${threadId}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load thread");
        if (!cancelled) setMessages(json.messages || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-[60] flex items-center justify-center bg-[var(--nucleus-deep)]/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="animate-scale-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h3 className="truncate text-sm font-bold text-[var(--color-text)]">
            {messages?.[0]?.subject || titleCase("Thread")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={titleCase("Close")}
            className="btn-ghost shrink-0 rounded-full p-2"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : !messages ? (
            <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
          ) : messages.length === 0 ? (
            <p className="text-sm italic text-[var(--color-text-muted)]">
              {titleCase("This thread has no messages.")}
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-text)]">{m.from}</p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{titleCase("To")}: {m.to}</p>
                  </div>
                  <time className="shrink-0 text-xs text-[var(--color-text-muted)]">
                    {new Date(m.date).toLocaleString()}
                  </time>
                </div>
                <EmailHtmlBody html={m.bodyHtml} plain={m.body} messageId={m.id} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
