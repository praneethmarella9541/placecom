"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, MessagesSquare, Search, UserRound } from "lucide-react";
import { normalizePhone, isValidE164 } from "@/lib/phone";
import { titleCase } from "@/lib/title-case";

type GoogleContact = {
  name: string;
  emails: string[];
  phones: string[];
  photoUrl?: string;
};

type ApiResult = {
  contacts?: GoogleContact[];
  hint?: string;
  error?: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  const [broken, setBroken] = useState(false);

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="h-11 w-11 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-bold text-white">
      {initials(name)}
    </span>
  );
}

export function GoogleContactsTab() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/google/contacts")
      .then((r) => r.json() as Promise<ApiResult>)
      .then(setData)
      .catch(() => setData({ error: "Failed to load Google contacts" }))
      .finally(() => setLoading(false));
  }, []);

  const contacts = data?.contacts ?? [];
  const filtered = search.trim()
    ? contacts.filter((c) => {
        const q = search.trim().toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.emails.some((e) => e.includes(q)) ||
          c.phones.some((p) => p.includes(q))
        );
      })
    : contacts;

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
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
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
          <UserRound className="h-7 w-7 text-[var(--color-text-faint)]" />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-[var(--color-text)]">
          {titleCase("Could not load Google contacts")}
        </p>
        <p className="mt-1 max-w-sm text-[13px] text-[var(--color-text-muted)]">{data.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data?.hint && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          {data.hint}
        </div>
      )}

      <div className="relative min-w-0 sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={titleCase("Search by name, phone, or email")}
          className="input-field w-full pl-9 text-[13px]"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              <UserRound className="h-7 w-7 text-[var(--color-text-faint)]" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--color-text)]">
              {contacts.length === 0 ? titleCase("No Google contacts found") : titleCase("No matches")}
            </p>
            <p className="mt-1 max-w-sm text-[13px] text-[var(--color-text-muted)]">
              {contacts.length === 0
                ? "Contacts from your Google account will appear here."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {filtered.map((c, i) => {
              const rawPhone = c.phones[0];
              const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
              const validPhone = normalizedPhone && isValidE164(normalizedPhone) ? normalizedPhone : null;
              const email = c.emails[0];
              return (
                <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4">
                  <Avatar name={c.name} photoUrl={c.photoUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{c.name}</p>
                    <p className="truncate text-[13px] text-[var(--color-text-muted)]">
                      {rawPhone ?? email ?? ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {validPhone && (
                      <Link
                        href={`/whatsapp?peer=${encodeURIComponent(validPhone)}`}
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-[#25d366]"
                        title={titleCase("Message on WhatsApp")}
                        aria-label={titleCase("Message on WhatsApp")}
                      >
                        <MessagesSquare className="h-4 w-4" />
                      </Link>
                    )}
                    {email && (
                      <button
                        type="button"
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-[var(--color-text-muted)]"
                        title={titleCase("Compose email")}
                        aria-label={titleCase("Compose email")}
                        onClick={() => router.push(`/inbox?composeTo=${encodeURIComponent(email)}`)}
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {contacts.length > 0 && (
        <p className="text-center text-[12px] text-[var(--color-text-faint)]">
          {contacts.length} contact{contacts.length !== 1 ? "s" : ""} from Google
        </p>
      )}
    </div>
  );
}
