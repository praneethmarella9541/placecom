"use client";

import { ContactBook } from "@/components/ContactBook";
import { titleCase } from "@/lib/title-case";

export default function ContactsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Contact book")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {titleCase("Save contact names once — they show in WhatsApp and SMS instead of phone numbers.")}
        </p>
      </div>
      <ContactBook />
    </div>
  );
}
