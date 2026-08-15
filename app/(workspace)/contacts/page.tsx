"use client";

import { useState } from "react";
import { ContactBook } from "@/components/ContactBook";
import { ContactDirectory } from "@/components/ContactDirectory";
import { GoogleContactsTab } from "@/components/GoogleContactsTab";
import { titleCase } from "@/lib/title-case";

type Tab = "my-contacts" | "directory" | "google";

export default function ContactsPage() {
  const [tab, setTab] = useState<Tab>("my-contacts");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Contact book")}
        </h1>
      </div>

      <div className="flex gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        <button
          type="button"
          onClick={() => setTab("my-contacts")}
          className={`flex-1 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
            tab === "my-contacts"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          My Contacts
        </button>
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

      {tab === "my-contacts" ? <ContactBook /> : tab === "directory" ? <ContactDirectory /> : <GoogleContactsTab />}
    </div>
  );
}
