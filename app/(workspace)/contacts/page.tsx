"use client";

import { useState } from "react";
import { LushaMark } from "@/components/LushaLogo";
import { ContactDirectory } from "@/components/ContactDirectory";
import { GoogleContactsTab } from "@/components/GoogleContactsTab";
import { LushaCsvEnrich } from "@/components/LushaCsvEnrich";
import { LushaProspectPanel } from "@/components/LushaProspectPanel";
import { useLushaConnected } from "@/hooks/useLushaConnected";
import { titleCase } from "@/lib/title-case";

type Tab = "directory" | "google" | "find" | "enrich";

/**
 * Team Directory (directory_contacts) is the one shared, universal address
 * book — SMS and the CRM all read/write it. The old per-user
 * "My Contacts" tab (wa_contacts) was retired in favor of it; see the
 * 0049 migration for the one-time data fold-in.
 */
export default function ContactsPage() {
  const [tab, setTab] = useState<Tab>("directory");
  const lushaConnected = useLushaConnected();
  // Bumped when people are added from a search, so the directory remounts with them in it.
  const [directoryKey, setDirectoryKey] = useState(0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Contact book")}
        </h1>
      </div>

      <div className="flex max-w-2xl gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        <button
          type="button"
          onClick={() => setTab("directory")}
          className={`flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
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
          className={`flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
            tab === "google"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Google Contacts
        </button>
        {lushaConnected ? (
          <button
            type="button"
            data-testid="contacts-find-tab"
            onClick={() => setTab("find")}
            className={`flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
              tab === "find"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <LushaMark className="h-4 w-4" />
              Find people
            </span>
          </button>
        ) : null}
        {lushaConnected ? (
          <button
            type="button"
            data-testid="contacts-enrich-tab"
            onClick={() => setTab("enrich")}
            className={`flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
              tab === "enrich"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <LushaMark className="h-4 w-4" />
              Enrich a list
            </span>
          </button>
        ) : null}
      </div>

      {tab === "directory" ? (
        <ContactDirectory key={directoryKey} />
      ) : tab === "google" ? (
        <GoogleContactsTab />
      ) : tab === "enrich" ? (
        <LushaCsvEnrich />
      ) : (
        <LushaProspectPanel onAdded={() => setDirectoryKey((k) => k + 1)} />
      )}
    </div>
  );
}
