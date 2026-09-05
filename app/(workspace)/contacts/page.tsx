"use client";

import { useState } from "react";
import { ContactDirectory } from "@/components/ContactDirectory";
import { GoogleContactsTab } from "@/components/GoogleContactsTab";
import { titleCase } from "@/lib/title-case";

type Tab = "directory" | "google";

/**
 * Team Directory (directory_contacts) is the one shared, universal address
 * book — WhatsApp, SMS, and the CRM all read/write it. The old per-user
 * "My Contacts" tab (wa_contacts) was retired in favor of it; see the
 * 0049 migration for the one-time data fold-in.
 */
export default function ContactsPage() {
  const [tab, setTab] = useState<Tab>("directory");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Contact book")}
        </h1>
      </div>

      <div className="flex max-w-md gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        <button
          type="button"
          onClick={() => setTab("directory")}
          className={`flex-1 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
            tab === "directory"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Team Directory
        </button>
        <button
          type="button"
          onClick={() => setTab("google")}
          className={`flex-1 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
            tab === "google"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Google Contacts
        </button>
      </div>

      {tab === "directory" ? <ContactDirectory /> : <GoogleContactsTab />}
    </div>
  );
}
