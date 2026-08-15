"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCalendar, IconMail, IconMenu, IconPhone, IconWhatsApp } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

type QuickPost = "call" | "note" | null;

/**
 * Quick Interaction Logger — Send Email / Log Call / Schedule Meeting / Send WhatsApp /
 * Add Note. Email/WhatsApp/Meeting deep-link into existing flows (mailto:, /whatsapp?peer=,
 * /calendar); Log Call and Add Note post straight to crm_contact_notes (kind: call|note).
 */
export function ContactDetailQuickLogger({
  contactId,
  email,
  phone,
  onLogged,
}: {
  contactId: string;
  email: string | null;
  phone: string | null;
  onLogged: () => void;
}) {
  const [open, setOpen] = useState<QuickPost>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitQuickPost(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !open) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/directory-contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text.trim(), kind: open }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to save");
      }
      setText("");
      setOpen(null);
      onLogged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-[13px] font-bold text-[var(--color-text)]">
        {titleCase("Quick interaction logger")}
      </h3>
      <div className="flex flex-wrap gap-2">
        {email ? (
          <a
            href={`mailto:${email}`}
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          >
            <IconMail className="h-3.5 w-3.5" />
            {titleCase("Send email")}
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(open === "call" ? null : "call")}
          className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
        >
          <IconPhone className="h-3.5 w-3.5" />
          {titleCase("Log call")}
        </button>
        <Link
          href="/calendar"
          className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
        >
          <IconCalendar className="h-3.5 w-3.5" />
          {titleCase("Schedule meeting")}
        </Link>
        {phone ? (
          <Link
            href={`/whatsapp?peer=${encodeURIComponent(phone)}`}
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#25d366]"
          >
            <IconWhatsApp className="h-3.5 w-3.5" />
            {titleCase("Send WhatsApp")}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(open === "note" ? null : "note")}
          className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
        >
          <IconMenu className="h-3.5 w-3.5" />
          {titleCase("Add note")}
        </button>
      </div>

      {open && (
        <form onSubmit={(e) => void submitQuickPost(e)} className="mt-3 space-y-2">
          <textarea
            data-testid={`quick-logger-${open}-input`}
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={titleCase(open === "call" ? "What happened on the call?" : "Note…")}
            className="input-field w-full text-[13px]"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost px-3 text-[12px]" onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="btn-primary-copper px-3 text-[12px] disabled:opacity-60"
            >
              {busy ? "Saving…" : titleCase("Save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
