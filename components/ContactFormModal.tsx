"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import {
  isLikelyLinkedInUrl,
  normalizeLinkedInUrl,
  type DirectoryContact,
  type DuplicateContact,
} from "@/lib/contact-directory";
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

/**
 * The phone box holds the 10-digit local number, with +91 drawn beside it.
 * A number saved with another country code (or typed starting with "+") is
 * shown in full with no prefix, so nothing foreign is ever rewritten as +91.
 */
function phoneToField(stored: string): string {
  const m = stored.trim().match(/^\+91(\d{10})$/);
  return m ? m[1] : stored.trim();
}

function cleanPhoneInput(raw: string): string {
  if (raw.trim().startsWith("+")) return "+" + raw.replace(/\D/g, "");
  let digits = raw.replace(/\D/g, "");
  // Pasted "919876543210" or "09876543210" -> the 10-digit local number.
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function contactToFormInput(c: DirectoryContact): DirectoryContactInput {
  return {
    name: c.name,
    company: c.company ?? "",
    title: c.title ?? "",
    email: c.email ?? "",
    phone: phoneToField(c.phone ?? ""),
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
  const [form, setForm] = useState<DirectoryContactInput>({ ...initial, phone: phoneToField(initial.phone ?? "") });
  const [tagsText, setTagsText] = useState((initial.tags ?? []).join(", "));
  const [formError, setFormError] = useState<string | null>(null);
  /** The saved contact this card would duplicate; set when the server answers 409. */
  const [duplicate, setDuplicate] = useState<DuplicateContact | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submitForm(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    const phone = (form.phone ?? "").trim();
    if (phone && !phone.startsWith("+") && phone.length !== 10) {
      setFormError("Enter a 10-digit mobile number");
      return;
    }
    const linkedin = (form.linkedin_url ?? "").trim();
    const linkedinChanged = linkedin !== (initial.linkedin_url ?? "").trim();
    if (linkedin && linkedinChanged && !isLikelyLinkedInUrl(normalizeLinkedInUrl(linkedin))) {
      setFormError("This isn't a LinkedIn link. Use linkedin.com/in/…");
      return;
    }
    setBusy(true);
    setFormError(null);
    setDuplicate(null);
    setDuplicateOpen(false);
    try {
      const payload: DirectoryContactInput & { allowDuplicate?: boolean } = {
        ...form,
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
        phone: phone && !phone.startsWith("+") ? `+91${phone}` : phone,
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
      const data = (await res.json()) as {
        contact?: DirectoryContact;
        error?: string;
        duplicate?: DuplicateContact;
      };
      if (res.status === 409 && data.duplicate) {
        setDuplicate(data.duplicate);
        return;
      }
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
              <div className="flex">
                {!form.phone?.startsWith("+") && (
                  <span className="flex h-10 shrink-0 items-center rounded-l-[var(--radius-md)] border border-r-0 border-[var(--color-border-strong)] bg-[var(--color-surface-offset)] px-3 text-[13px] text-[var(--color-text-muted)]">
                    +91
                  </span>
                )}
                <input
                  data-testid="directory-phone-input"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: cleanPhoneInput(e.target.value) }))}
                  className={`input-field w-full min-w-0 text-[13px] ${form.phone?.startsWith("+") ? "" : "rounded-l-none"}`}
                  placeholder="10-digit mobile"
                />
              </div>
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
          {duplicate && (
            <div
              data-testid="directory-duplicate-warning"
              className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-light)] px-3 py-2.5 text-[13px] text-[var(--color-text)]"
            >
              <p>
                <strong>{duplicate.name}</strong> is already saved with this{" "}
                {duplicate.email && form.email?.trim().toLowerCase() === duplicate.email.toLowerCase()
                  ? "email"
                  : "phone number"}
                .{" "}
                <button
                  type="button"
                  data-testid="directory-duplicate-view"
                  aria-expanded={duplicateOpen}
                  className="font-semibold text-[var(--color-copper)] hover:underline"
                  onClick={() => setDuplicateOpen((v) => !v)}
                >
                  {duplicateOpen ? "Hide contact" : "View contact"}
                </button>
              </p>
              {duplicateOpen && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-[var(--color-surface)] px-3 py-2 text-[12.5px]">
                  {(
                    [
                      ["Name", duplicate.name],
                      ["Email", duplicate.email],
                      ["Phone", duplicate.phone],
                      ["Company", duplicate.company],
                      ["Designation", duplicate.title],
                      ["Location", duplicate.location],
                      ["LinkedIn", duplicate.linkedin_url],
                      ["Tags", duplicate.tags?.length ? duplicate.tags.join(", ") : null],
                    ] as [string, string | null][]
                  )
                    .filter(([, v]) => v)
                    .map(([label, v]) => (
                      <div key={label} className="contents">
                        <dt className="text-[var(--color-text-muted)]">{label}</dt>
                        <dd className="min-w-0 break-words text-[var(--color-text)]">{v}</dd>
                      </div>
                    ))}
                </dl>
              )}
              <button
                data-testid="directory-duplicate-save-anyway"
                type="button"
                className="mt-2 block text-[12.5px] font-semibold text-[var(--color-copper)] hover:underline disabled:opacity-60"
                disabled={busy}
                onClick={(e) => void submitForm(e, true)}
              >
                Save anyway
              </button>
            </div>
          )}
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
