"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
import { CompanyDetailPanel } from "@/components/CompanyDetailPanel";

export type CompanyRow = {
  id: string;
  domain: string;
  company_name: string;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_total: number;
  synced_at: string | null;
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) => c.company_name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/companies");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load companies");
      }
      const json = await res.json();
      setCompanies(json.companies || []);
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  async function handleSync() {
    setSyncing(true);
    setSyncSummary(null);
    try {
      const res = await fetch("/api/crm/companies/sync", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Sync failed");
      }
      const json = await res.json();
      setSyncSummary(
        titleCase(
          `Synced ${json.messagesScanned} emails — found ${json.companiesFound} companies, ${json.contactsFound} contacts.`
        )
      );
      await loadCompanies();
    } catch (err: unknown) {
      alert(errMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="font-display text-[17px] font-bold text-[var(--color-text)]">
            {titleCase("Companies")}
          </h1>
          <Link
            data-testid="crm-companies-back-to-pipeline"
            href="/crm"
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            {titleCase("Pipeline")}
          </Link>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              data-testid="crm-companies-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={titleCase("Search companies...")}
              className="input-field h-9 w-56 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            data-testid="crm-companies-sync"
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="btn-primary gap-1.5 py-1.5 text-[13px] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {titleCase(syncing ? "Syncing your whole mailbox..." : "Sync from mailbox")}
          </button>
          <p className="text-xs text-[var(--color-text-muted)]">
            {syncSummary
              ? syncSummary
              : syncing
                ? titleCase("Scanning your entire mailbox — this can take a few minutes.")
                : titleCase("Scans your whole mailbox — may take a few minutes.")}
          </p>
        </div>
      </div>

      <div className="surface-card overflow-hidden p-0">
        {loading ? (
          <p className="p-6 text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-500">{error}</p>
        ) : companies.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              {titleCase("No companies yet — sync your mailbox to auto-populate this list.")}
            </p>
          </div>
        ) : filteredCompanies.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-text-muted)]">
            {titleCase("No companies match your search.")}
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-4 py-3">{titleCase("Company")}</th>
                <th className="px-4 py-3">{titleCase("Domain")}</th>
                <th className="px-4 py-3">{titleCase("Last interaction")}</th>
                <th className="px-4 py-3">{titleCase("Connection")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((c) => (
                <tr
                  key={c.id}
                  data-testid={`crm-company-row-${c.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveCompanyId(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setActiveCompanyId(c.id);
                  }}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-offset)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--color-text)]">
                    {c.company_name}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.domain}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {c.last_interaction_at
                      ? new Date(c.last_interaction_at).toLocaleDateString()
                      : titleCase("No contact")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          CONNECTION_STRENGTH_DOT[c.connection_strength ?? "No communication"]
                        }`}
                      />
                      {titleCase(c.connection_strength ?? "No communication")}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>

      {/* Rendered outside the space-y-5 container above — Tailwind's sibling margin
          utility was pushing this fixed-position drawer down from the true viewport
          top (position:fixed still respects its own margin). */}
      {activeCompanyId && (
        <CompanyDetailPanel companyId={activeCompanyId} onClose={() => setActiveCompanyId(null)} />
      )}
    </>
  );
}
