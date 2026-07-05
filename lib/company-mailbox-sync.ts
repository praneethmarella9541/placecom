import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { collectMessageIdsForFetch, fetchGmailMessageHeadersByIds } from "@/lib/gmail";
import { bucketEmailConnection } from "@/lib/email-connection-strength";
import { guessCompanyNameFromDomain } from "@/lib/company-name";

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "rediffmail.com",
]);

type ParsedAddress = { name: string | null; email: string };

/** Splits a header address list on top-level commas (ignores commas inside quoted display names). */
function splitAddressList(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAddress(entry: string): ParsedAddress | null {
  const angleMatch = entry.match(/<([^<>]+)>/);
  let email: string;
  let name: string | null = null;
  if (angleMatch) {
    email = angleMatch[1].trim();
    name = entry.slice(0, angleMatch.index).replace(/"/g, "").trim() || null;
  } else {
    email = entry.trim();
  }
  email = email.toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return { name, email };
}

function parseAddressHeader(header: string): ParsedAddress[] {
  if (!header) return [];
  return splitAddressList(header)
    .map(parseAddress)
    .filter((a): a is ParsedAddress => a !== null);
}

function domainOf(email: string): string {
  return email.slice(email.indexOf("@") + 1).toLowerCase();
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export type SyncCompaniesSummary = {
  companiesFound: number;
  contactsFound: number;
  messagesScanned: number;
};

/**
 * Scans recent mailbox headers (From/To/Cc), groups external senders/recipients by
 * email domain, and upserts crm_companies / crm_company_contacts. Skips the
 * mailbox's own domain and common free-mail providers (not real companies).
 */
export async function syncCompaniesFromMailbox(
  supabase: SupabaseClient,
  userId: string,
  accessToken: string,
  opts: { gmailAddress?: string; maxEmails?: number | "all" } = {}
): Promise<SyncCompaniesSummary> {
  // Defaults to the whole mailbox (same ALL_MAIL_CAP ceiling used by /api/fetch-emails)
  // rather than a small recent-messages sample, so "sync" genuinely reflects all mail.
  const maxEmails =
    opts.maxEmails === undefined
      ? "all"
      : opts.maxEmails === "all"
        ? "all"
        : Math.min(10_000, Math.max(1, opts.maxEmails));
  const ownDomain = opts.gmailAddress ? domainOf(opts.gmailAddress) : undefined;

  const { messageIds } = await collectMessageIdsForFetch(accessToken, {
    maxEmails,
    labelFilter: "all",
  });

  const headers = await fetchGmailMessageHeadersByIds(accessToken, messageIds);

  type ContactAgg = { displayName: string | null; dates: number[] };
  type DomainAgg = { contacts: Map<string, ContactAgg>; dates: number[] };
  const domains = new Map<string, DomainAgg>();

  for (const msg of headers) {
    if (!msg.internalDate) continue;
    const addresses = [
      ...parseAddressHeader(msg.from),
      ...parseAddressHeader(msg.to),
      ...parseAddressHeader(msg.cc),
    ];

    for (const { name, email } of addresses) {
      const domain = domainOf(email);
      if (!domain || domain === ownDomain || FREE_EMAIL_DOMAINS.has(domain)) continue;

      let agg = domains.get(domain);
      if (!agg) {
        agg = { contacts: new Map(), dates: [] };
        domains.set(domain, agg);
      }
      agg.dates.push(msg.internalDate);

      const contact = agg.contacts.get(email);
      if (contact) {
        contact.dates.push(msg.internalDate);
        if (!contact.displayName && name) contact.displayName = name;
      } else {
        agg.contacts.set(email, { displayName: name, dates: [msg.internalDate] });
      }
    }
  }

  const now = Date.now();
  let contactsFound = 0;

  for (const [domain, agg] of Array.from(domains.entries())) {
    const lastMs = Math.max(...agg.dates);
    const firstMs = Math.min(...agg.dates);
    const lastInteractionAt = new Date(lastMs).toISOString();
    const recentCount90d = agg.dates.filter((d) => now - d <= NINETY_DAYS_MS).length;
    const connectionStrength = bucketEmailConnection({ lastInteractionAt, recentCount90d });

    const { data: companyRow, error: companyErr } = await supabase
      .from("crm_companies")
      .upsert(
        {
          user_id: userId,
          domain,
          company_name: guessCompanyNameFromDomain(domain),
          first_seen_at: new Date(firstMs).toISOString(),
          last_interaction_at: lastInteractionAt,
          connection_strength: connectionStrength,
          message_count_90d: recentCount90d,
          message_count_total: agg.dates.length,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,domain" }
      )
      .select("id")
      .single();

    if (companyErr || !companyRow) continue;

    for (const [email, contact] of Array.from(agg.contacts.entries())) {
      const contactLastMs = Math.max(...contact.dates);
      const { error: contactErr } = await supabase.from("crm_company_contacts").upsert(
        {
          company_id: companyRow.id,
          user_id: userId,
          email,
          display_name: contact.displayName,
          last_interaction_at: new Date(contactLastMs).toISOString(),
          message_count: contact.dates.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,email" }
      );
      if (!contactErr) contactsFound += 1;
    }
  }

  return {
    companiesFound: domains.size,
    contactsFound,
    messagesScanned: headers.length,
  };
}
