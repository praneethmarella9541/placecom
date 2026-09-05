"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconBuilding, IconLinkedin, IconMail, IconMapPin, IconPhone, IconWhatsAppLogo } from "@/components/Icons";
import { ContactFormModal, contactToFormInput } from "@/components/ContactFormModal";
import { ContactDetailQuickLogger } from "@/components/ContactDetailQuickLogger";
import { ContactActivityTimeline } from "@/components/ContactActivityTimeline";
import { useDirectoryContact } from "@/hooks/useDirectoryContacts";
import { contactLinkedInSearchUrl } from "@/lib/contact-directory";
import { formatPhone } from "@/lib/wa-contacts-display";
import { titleCase } from "@/lib/title-case";

type MatchedLead = {
  id: string;
  company_name: string;
  stage: string;
  score: string;
  lead_type: string;
  jd_count: number;
  staff_name: string;
};

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { contact, loading, error, reload } = useDirectoryContact(id);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState<MatchedLead | null>(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [timelineKey, setTimelineKey] = useState(0);
  const [addingToCrm, setAddingToCrm] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setLeadLoading(true);
    const qs = new URLSearchParams();
    if (contact.email) qs.set("email", contact.email);
    if (contact.phone) qs.set("phone", contact.phone);
    fetch(`/api/crm/leads/match?${qs.toString()}`)
      .then((res) => res.json())
      .then((json) => setLead(json.lead ?? null))
      .catch(() => setLead(null))
      .finally(() => setLeadLoading(false));
  }, [contact?.email, contact?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * One of the two ways a lead enters the CRM (the other being the board's
   * bulk import). Classification is kicked off for just this lead and
   * deliberately not awaited — the card is on the board either way, and the
   * user shouldn't sit through an OpenAI round-trip to see it appear.
   */
  async function handleAddToCrm() {
    if (!contact) return;
    setAddingToCrm(true);
    try {
      const res = await fetch("/api/crm/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: [contact.id] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to add to CRM");

      const leadIds: string[] = json.leadIds ?? [];
      if (leadIds.length > 0) {
        void fetch("/api/crm/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadIds }),
        });
      }
      router.push("/crm");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to add to CRM");
    } finally {
      setAddingToCrm(false);
    }
  }

  async function handleDelete() {
    if (!contact) return;
    if (!window.confirm(`Remove ${contact.name} from the team directory?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/directory-contacts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      router.push("/contacts");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="p-8 text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>;
  }
  if (error || !contact) {
    return (
      <div className="p-8">
        <p className="text-[13px] text-[var(--color-danger)]">{error || "Contact not found"}</p>
        <Link href="/contacts" className="mt-3 inline-block text-[13px] text-[var(--color-copper)] hover:underline">
          {titleCase("Back to directory")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {titleCase("Back to directory")}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="btn-ghost inline-flex items-center gap-1.5 px-3 text-[13px] font-semibold"
          >
            <Pencil className="h-3.5 w-3.5" />
            {titleCase("Edit profile")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDelete()}
            className="btn-ghost inline-flex items-center gap-1.5 px-3 text-[13px] font-semibold text-[var(--color-danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {titleCase("Delete")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <div className="surface-card space-y-4 p-5">
            <GmailAvatar seed={contact.email || contact.id} name={contact.name} size={64} />
            {!leadLoading && (
              <span
                className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  lead ? "bg-[var(--color-warning-light)] text-[var(--color-warning)]" : "bg-[var(--color-surface-offset)] text-[var(--color-text-faint)]"
                }`}
              >
                {lead ? titleCase(lead.stage) : titleCase("Not in pipeline")}
              </span>
            )}
            <div>
              <h1 className="font-display text-xl font-bold text-[var(--color-text)]">{contact.name}</h1>
              {contact.title && <p className="text-[13px] text-[var(--color-text-muted)]">{contact.title}</p>}
              {contact.company && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-offset)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text)]">
                  <IconBuilding className="h-3 w-3" />
                  {contact.company}
                </span>
              )}
            </div>

            <div className="space-y-2 border-t border-[var(--color-border)] pt-3 text-[13px]">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline">
                  <IconMail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline">
                  <IconPhone className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{formatPhone(contact.phone)}</span>
                </a>
              )}
              {contact.phone && (
                <Link
                  href={`/whatsapp?peer=${encodeURIComponent(contact.phone)}`}
                  className="flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
                >
                  <IconWhatsAppLogo className="h-3.5 w-3.5 shrink-0" />
                  <span>{titleCase("WhatsApp")}</span>
                </Link>
              )}
              {contact.location && (
                <p className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <IconMapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{contact.location}</span>
                </p>
              )}
              <a
                href={contact.linkedin_url || contactLinkedInSearchUrl(contact)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
              >
                <IconLinkedin className="h-3.5 w-3.5 shrink-0" />
                <span>{contact.linkedin_url ? titleCase("LinkedIn profile") : titleCase("Find on LinkedIn")}</span>
              </a>
            </div>

            {contact.tags && contact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!lead && !leadLoading && (
            <div className="surface-card space-y-2 p-5">
              <h3 className="text-[13px] font-bold text-[var(--color-text)]">{titleCase("CRM")}</h3>
              <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                {titleCase(
                  "Not on the board yet. Adding them runs the classifier over your mail and WhatsApp with them."
                )}
              </p>
              <button
                type="button"
                onClick={() => void handleAddToCrm()}
                disabled={addingToCrm}
                className="btn-secondary h-8 w-full justify-center px-3 text-[12.5px]"
              >
                {addingToCrm ? titleCase("Adding…") : titleCase("Add to CRM")}
              </button>
            </div>
          )}

          {lead && (
            <div className="surface-card space-y-2 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-[var(--color-text)]">{titleCase("Active deal info")}</h3>
                <Link href="/crm" className="text-[12px] font-semibold text-[var(--color-copper)] hover:underline">
                  {titleCase("Open in CRM")}
                </Link>
              </div>
              <dl className="space-y-1.5 text-[13px]">
                <Row label="Stage" value={titleCase(lead.stage)} />
                <Row label="Score" value={titleCase(lead.score)} />
                <Row label="Owner" value={lead.staff_name} />
                {lead.jd_count > 0 && <Row label="JDs received" value={String(lead.jd_count)} />}
              </dl>
            </div>
          )}
        </div>

        <div className="surface-card min-w-0 space-y-6 p-5">
          <ContactDetailQuickLogger
            contactId={contact.id}
            email={contact.email}
            phone={contact.phone}
            name={contact.name}
            company={contact.company}
            onLogged={() => setTimelineKey((k) => k + 1)}
          />
          <div className="border-t border-[var(--color-border)] pt-5">
            <ContactActivityTimeline key={timelineKey} contactId={contact.id} />
          </div>
        </div>
      </div>

      {editOpen && (
        <ContactFormModal
          editingId={contact.id}
          initial={contactToFormInput(contact)}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--color-text-muted)]">{titleCase(label)}</dt>
      <dd className="font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
