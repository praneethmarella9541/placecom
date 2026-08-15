"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import type { DirectoryContact } from "@/lib/contact-directory";
import { titleCase } from "@/lib/title-case";

export const emptyContactForm: DirectoryContactInput = {
  name: "",
  company: "",
  title: "",
  email: "",
  phone: "",
  linkedin_url: "",
  location: "",
  tags: [],
  notes: "",
};

export function contactToFormInput(c: DirectoryContact): DirectoryContactInput {
  return {
    name: c.name,
    company: c.company ?? "",
    title: c.title ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    linkedin_url: c.linkedin_url ?? "",
    location: c.location ?? "",
    tags: c.tags ?? [],
    notes: c.notes ?? "",
  };
}

/**
 * Add/edit modal for a shared directory contact card. Self-contained (calls the API
 * directly) so both the directory table (ContactDirectory.tsx) and the contact detail
 * page ("Edit Profile") can open it without sharing a list-scoped hook instance.
 */
export function ContactFormModal({
  editingId,
  initial,
  onClose,
  onSaved,
}: {
  /** undefined = creating a new contact */
  editingId?: string | null;
  initial: DirectoryContactInput;
  onClose: () => void;
  onSaved: (contact: DirectoryContact) => void;
}) {
  const [form, setForm] = useState<DirectoryContactInput>(initial);
  const [tagsText, setTagsText] = useState((initial.tags ?? []).join(", "));
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: DirectoryContactInput = {
        ...form,
        tags: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const res = await fetch(
        editingId ? `/api/directory-contacts/${editingId}` : "/api/directory-contacts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as { contact?: DirectoryContact; error?: string };
      if (!res.ok || !data.contact) throw new Error(data.error || "Failed to save contact");
      onSaved(data.contact);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save contact");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-form-title"
      >
        <h2 id="directory-form-title" className="font-display text-lg font-bold text-[var(--color-text)]">
          {editingId ? titleCase("Edit contact") : titleCase("Add contact")}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          Visible to every teammate and admin in the shared directory.
        </p>
        <form data-testid="directory-form" className="mt-5 max-h-[65vh] space-y-4 overflow-y-auto pr-1" onSubmit={(e) => void submitForm(e)}>
          <FormField label="Name">
            <input
              data-testid="directory-name-input"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input-field w-full text-[13px]"
              placeholder="Full name"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Company">
              <input
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                className="input-field w-full text-[13px]"
                placeholder="Company"
              />
            </FormField>
            <FormField label="Designation">
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="input-field w-full text-[13px]"
                placeholder="Job title"
              />
            </FormField>
          </div>
          <FormField label="Email">
            <input
              data-testid="directory-email-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="input-field w-full text-[13px]"
              placeholder="name@company.com"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone">
              <input
                data-testid="directory-phone-input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="input-field w-full text-[13px]"
                placeholder="+91… or 10-digit mobile"
              />
            </FormField>
            <FormField label="Location">
              <input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="input-field w-full text-[13px]"
                placeholder="City, Country"
              />
            </FormField>
          </div>
          <FormField label="LinkedIn">
            <input
              data-testid="directory-linkedin-input"
              value={form.linkedin_url}
              onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))}
              className="input-field w-full text-[13px]"
              placeholder="linkedin.com/in/…"
            />
          </FormField>
          <FormField label="Tags">
            <input
              data-testid="directory-tags-input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className="input-field w-full text-[13px]"
              placeholder="Enterprise, SaaS, Decision-maker"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Comma-separated</p>
          </FormField>
          {formError && (
            <p data-testid="directory-form-error" className="text-[13px] text-[var(--color-danger)]">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button data-testid="directory-form-cancel" type="button" className="btn-ghost px-4" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button data-testid="directory-form-submit" type="submit" className="btn-primary-copper px-4" disabled={busy}>
              {busy ? "Saving…" : editingId ? titleCase("Save changes") : titleCase("Add contact")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
        {titleCase(label)}
      </label>
      {children}
    </div>
  );
}
