"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCalendar, IconMail, IconMenu, IconWhatsAppLogo } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

type QuickPost = "note" | null;

/**
 * Quick Interaction Logger — Send Email / Schedule Meeting / Send WhatsApp / Add Note.
 * Email/WhatsApp/Meeting deep-link into existing flows (/inbox?composeTo=, /whatsapp?peer=,
 * /calendar); Add Note posts straight to crm_contact_notes (kind: note).
 */
export function ContactDetailQuickLogger({
  contactId,
  email,
  phone,
  name,
  company,
  onLogged,
}: {
  contactId: string;
  email: string | null;
  phone: string | null;
  name?: string | null;
  company?: string | null;
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
          <Link
            href={`/inbox?composeTo=${encodeURIComponent(email)}`}
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          >
            <IconMail className="h-3.5 w-3.5" />
            {titleCase("Send email")}
          </Link>
        ) : null}
        <Link
          href={(() => {
            const params = new URLSearchParams({ action: "new" });
            if (email) params.set("attendee", email);
            const title = name ? `Meeting with ${name}${company ? ` (${company})` : ""}` : "";
            if (title) params.set("title", title);
            return `/calendar?${params.toString()}`;
          })()}
          className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
        >
          <IconCalendar className="h-3.5 w-3.5" />
          {titleCase("Schedule meeting")}
        </Link>
        {phone ? (
          <Link
            href={`/whatsapp?peer=${encodeURIComponent(phone)}`}
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          >
            <IconWhatsAppLogo className="h-3.5 w-3.5" />
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
            placeholder={titleCase("Note…")}
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
