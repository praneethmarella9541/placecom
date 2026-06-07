"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare, MessagesSquare, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useWaContacts } from "@/hooks/useWaContacts";
import { formatPhone, peerInitials } from "@/lib/wa-contacts-display";
import { isValidE164, normalizePhone } from "@/lib/phone";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type FormState = {
  peer: string;
  name: string;
};

const emptyForm: FormState = { peer: "", name: "" };

export function ContactBook() {
  const { contacts, loading, error, reload, saveContact, deleteContact } = useWaContacts();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingPeer, setEditingPeer] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const phone = formatPhone(c.peer_e164).toLowerCase();
      return c.name.toLowerCase().includes(q) || c.peer_e164.includes(q) || phone.includes(q);
    });
  }, [contacts, search]);

  function openAdd() {
    setEditingPeer(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(peer: string, name: string) {
    setEditingPeer(peer);
    setForm({ peer, name });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingPeer(null);
    setForm(emptyForm);
    setFormError(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const peer = normalizePhone(form.peer.trim());
    if (!name) {
      setFormError("Name is required");
      return;
    }
    if (!isValidE164(peer)) {
      setFormError("Enter a valid mobile number, e.g. +918489431508 or 10 digits");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await saveContact(peer, name);
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save contact");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(peer: string, name: string) {
    if (!window.confirm(`Remove ${name} from your contact book?`)) return;
    setBusy(true);
    try {
      await deleteContact(peer);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete contact");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={titleCase("Search by name or number")}
            className="input-field w-full pl-9 text-[13px]"
          />
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2 px-4" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {titleCase("Add contact")}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {loading ? (
          <div className="divide-y divide-[var(--color-border)]">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="h-11 w-11 animate-pulse rounded-full bg-[var(--color-surface-offset)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              <UserRound className="h-7 w-7 text-[var(--color-text-faint)]" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--color-text)]">
              {contacts.length === 0 ? titleCase("No contacts yet") : titleCase("No matches")}
            </p>
            <p className="mt-1 max-w-sm text-[13px] text-[var(--color-text-muted)]">
              {contacts.length === 0
                ? "Save names here and they will appear in WhatsApp and SMS instead of phone numbers."
                : "Try a different search term."}
            </p>
            {contacts.length === 0 && (
              <button type="button" className="btn-primary mt-5 inline-flex items-center gap-2" onClick={openAdd}>
                <Plus className="h-4 w-4" />
                {titleCase("Add your first contact")}
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {filtered.map((c) => (
              <li key={c.peer_e164} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[13px] font-bold text-white">
                  {peerInitials(c.peer_e164, c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{c.name}</p>
                  <p className="truncate text-[13px] text-[var(--color-text-muted)]">{formatPhone(c.peer_e164)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/whatsapp?peer=${encodeURIComponent(c.peer_e164)}`}
                    className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-[#25d366]"
                    title={titleCase("Message on WhatsApp")}
                    aria-label={titleCase("Message on WhatsApp")}
                  >
                    <MessagesSquare className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/sms?peer=${encodeURIComponent(c.peer_e164)}`}
                    className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-[var(--color-primary)]"
                    title={titleCase("Send SMS")}
                    aria-label={titleCase("Send SMS")}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0"
                    title={titleCase("Edit")}
                    onClick={() => openEdit(c.peer_e164, c.name)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-[var(--color-danger)]"
                    title={titleCase("Delete")}
                    onClick={() => void handleDelete(c.peer_e164, c.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-form-title"
          >
            <h2 id="contact-form-title" className="font-display text-lg font-bold text-[var(--color-text)]">
              {editingPeer ? titleCase("Edit contact") : titleCase("Add contact")}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              Names appear in WhatsApp and SMS chats instead of the raw number.
            </p>
            <form className="mt-5 space-y-4" onSubmit={(e) => void submitForm(e)}>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                  {titleCase("Name")}
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-field w-full text-[13px]"
                  placeholder="Recruiter name"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                  {titleCase("Phone")}
                </label>
                <input
                  value={form.peer}
                  onChange={(e) => setForm((f) => ({ ...f, peer: e.target.value }))}
                  disabled={!!editingPeer}
                  className={cn("input-field w-full text-[13px]", editingPeer && "opacity-60")}
                  placeholder="+91… or 10-digit mobile"
                />
              </div>
              {formError && (
                <p className="text-[13px] text-[var(--color-danger)]">{formError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-ghost px-4" onClick={closeForm} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-4" disabled={busy}>
                  {busy ? "Saving…" : editingPeer ? titleCase("Save changes") : titleCase("Add contact")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
