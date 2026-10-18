"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, ExternalLink, Loader2, Mail, Phone, Search, UserPlus, UserRound, Users } from "lucide-react";
import { LushaMark } from "@/components/LushaLogo";
import {
  CompanyFilters,
  ContactFilters,
  companyBody,
  companyFilterCount,
  contactBody,
  contactFilterCount,
  emptyCompanyFilters,
  emptyContactFilters,
} from "@/components/LushaProspectFilters";
import type { ProspectPerson } from "@/app/api/integrations/lusha/prospect/route";
import type { RevealedPerson } from "@/app/api/integrations/lusha/prospect/reveal/route";
import type { LushaCompany } from "@/lib/integrations/lusha";
import { cn } from "@/lib/utils";

const SIZES = [10, 25, 50];

type AddResult = {
  added: number;
  skippedAlreadyThere: string[];
  reveal: { found: number; updated: number; creditsCharged: number } | null;
  revealBlocked: string | null;
};

type Tab = "contacts" | "companies";

/** What the table knows about one person's reveal, and which fields were actually asked for. */
type Shown = RevealedPerson & { askedEmails: boolean; askedPhones: boolean };

/**
 * Find people and companies with the workspace's Lusha account, and add the people you want to the
 * contact book. Two tabs, like Lusha: Contacts (company and contact filters) and Companies.
 *
 * A search is charged at the plan's search rate (the price list, e.g. 1 credit per 25 results), so the
 * size you pick sets the most it can cost, shown on the button; the exact charge comes back after the
 * search. Adding people costs nothing; revealing their email or phone is optional, per person, and
 * priced beforehand.
 */
export function LushaProspectPanel({ onAdded }: { onAdded: () => void }) {
  const [tab, setTab] = useState<Tab>("contacts");
  const [company, setCompany] = useState(emptyCompanyFilters);
  const [contact, setContact] = useState(emptyContactFilters);
  const [open, setOpen] = useState<Set<string>>(new Set(["co-name", "ct-title"]));
  const [size, setSize] = useState(25);
  const [estimate, setEstimate] = useState<number | null>(null);
  // The plan's search price, e.g. 1 credit per 25 results, as the price list states it.
  const [rate, setRate] = useState<{ credits: number; perQuantity: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<ProspectPerson[] | null>(null);
  const [companies, setCompanies] = useState<LushaCompany[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<{ total: number; creditsCharged: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedCompanies, setPickedCompanies] = useState<Set<string>>(new Set());
  const [revealEmails, setRevealEmails] = useState(false);
  const [revealPhones, setRevealPhones] = useState(false);
  const [adding, setAdding] = useState(false);
  // Emails and phones revealed right here in the results, by person id. Adding to contacts is a
  // separate choice and carries these along.
  const [revealed, setRevealed] = useState<Record<string, Shown>>({});
  const [revealing, setRevealing] = useState(false);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);

  const companyCount = companyFilterCount(company);
  const contactCount = contactFilterCount(contact);
  const canSearch = companyCount + contactCount > 0;
  const endpoint = tab === "companies" ? "/api/integrations/lusha/prospect/companies" : "/api/integrations/lusha/prospect";

  // The most a search can charge, shown before it runs. Only needs the page size, so it is cheap.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: ["probe.com"], size, dryRun: true }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          estimatedCredits?: number;
          rate?: { credits: number; perQuantity: number } | null;
        };
        if (live) {
          setEstimate(res.ok ? (json.estimatedCredits ?? null) : null);
          setRate(res.ok ? (json.rate ?? null) : null);
        }
      } catch {
        if (live) {
          setEstimate(null);
          setRate(null);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [size, endpoint]);

  async function search() {
    if (!canSearch || searching) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const body = { ...companyBody(company), ...contactBody(contact), size };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        people?: ProspectPerson[];
        companies?: LushaCompany[];
        total?: number;
        creditsCharged?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Lusha couldn't complete that search.");
        return;
      }
      if (tab === "companies") {
        setCompanies(json.companies ?? []);
        setPickedCompanies(new Set());
      } else {
        setPeople(json.people ?? []);
        setPicked(new Set());
        setRevealed({});
        setRevealNote(null);
      }
      setSearchInfo({ total: json.total ?? 0, creditsCharged: json.creditsCharged ?? 0 });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSearching(false);
    }
  }

  const addable = useMemo(() => (people ?? []).filter((p) => !p.inContactId), [people]);
  // Anyone ticked can be revealed; only people not yet in the contact book can be added.
  const pickedPeople = useMemo(() => (people ?? []).filter((p) => picked.has(p.id)), [people, picked]);
  const chosen = useMemo(() => addable.filter((p) => picked.has(p.id)), [addable, picked]);
  // Most a reveal can cost, counting only what is still missing. Lusha charges each data point once,
  // so someone already revealed for that field adds nothing.
  // Who still has nothing on screen for what is ticked. A reveal for them can cost nothing — Lusha says 0
  // when this account has paid for that person before — and it should still run, to bring it in.
  const missing = useMemo(
    () =>
      pickedPeople.filter((p) => {
        const noEmail = revealEmails && (revealed[p.id]?.emails.length ?? 0) === 0 && !p.contactEmail;
        const noPhone = revealPhones && (revealed[p.id]?.phones.length ?? 0) === 0 && !p.contactPhone;
        return noEmail || noPhone;
      }),
    [pickedPeople, revealed, revealEmails, revealPhones],
  );
  const revealEstimate = useMemo(
    () =>
      missing.reduce((sum, p) => {
        const noEmail = revealEmails && (revealed[p.id]?.emails.length ?? 0) === 0 && !p.contactEmail;
        const noPhone = revealPhones && (revealed[p.id]?.phones.length ?? 0) === 0 && !p.contactPhone;
        return sum + (noEmail ? (p.revealCost.emails ?? 1) : 0) + (noPhone ? (p.revealCost.phones ?? 5) : 0);
      }, 0),
    [missing, revealed, revealEmails, revealPhones],
  );

  /** What the table shows for this person and field: revealed here, else what the contact card holds. */
  function shownValues(p: ProspectPerson, field: "emails" | "phones"): string[] {
    const fromReveal = revealed[p.id]?.[field] ?? [];
    if (fromReveal.length > 0) return fromReveal;
    const card = field === "emails" ? p.contactEmail : p.contactPhone;
    return card ? [card] : [];
  }

  async function reveal() {
    if (missing.length === 0 || revealing || (!revealEmails && !revealPhones)) return;
    setRevealing(true);
    setError(null);
    setRevealNote(null);
    try {
      const res = await fetch("/api/integrations/lusha/prospect/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: missing.map((p) => p.id),
          reveal: [...(revealEmails ? ["emails"] : []), ...(revealPhones ? ["phones"] : [])],
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        revealed?: Record<string, RevealedPerson>;
        creditsCharged?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Could not reveal those details.");
        return;
      }
      const got = json.revealed ?? {};
      setRevealed((prev) => {
        const next = { ...prev };
        for (const [id, r] of Object.entries(got)) {
          const before = prev[id];
          // Keep what an earlier reveal already found; a later one for the other field only adds to it.
          next[id] = {
            emails: r.emails.length ? r.emails : (before?.emails ?? []),
            phones: r.phones.length ? r.phones : (before?.phones ?? []),
            status: before && r.status === "not_found" ? before.status : r.status,
            askedEmails: revealEmails || !!before?.askedEmails,
            askedPhones: revealPhones || !!before?.askedPhones,
          };
        }
        return next;
      });
      const found = Object.values(got).filter((r) => r.status === "found").length;
      const n = json.creditsCharged ?? 0;
      setRevealNote(`Found details for ${found} of ${Object.keys(got).length} · ${n} credit${n === 1 ? "" : "s"} charged.`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRevealing(false);
    }
  }

  async function add() {
    if (chosen.length === 0 || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/prospect/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // What was revealed in the table goes onto the new contact; adding itself costs nothing.
          people: chosen.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            title: p.title,
            company: p.company,
            location: p.location,
            linkedin: p.linkedin,
            email: revealed[p.id]?.emails[0],
            phone: revealed[p.id]?.phones[0],
          })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<AddResult> & { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not add those people.");
        return;
      }
      setResult({
        added: json.added ?? 0,
        skippedAlreadyThere: json.skippedAlreadyThere ?? [],
        reveal: json.reveal ?? null,
        revealBlocked: json.revealBlocked ?? null,
      });
      setPicked(new Set());
      // Mark the new people as contacts so they can't be added twice.
      const names = new Set(chosen.map((p) => p.id));
      setPeople((prev) => (prev ?? []).map((p) => (names.has(p.id) ? { ...p, inContactId: "added" } : p)));
      onAdded();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  /** From the Companies tab: look for people at the ticked companies. */
  function findPeopleAtPicked() {
    const chosenCompanies = (companies ?? []).filter((c) => pickedCompanies.has(c.id));
    setCompany({ ...emptyCompanyFilters(), companies: chosenCompanies.map((c) => c.domain ?? c.name).join(", ") });
    setOpen(new Set(["co-name", "ct-title"]));
    setTab("contacts");
    setSearchInfo(null);
    setResult(null);
  }

  const tabButton = (id: Tab, label: string, Icon: typeof UserRound, count: number) => (
    <button
      type="button"
      onClick={() => {
        setTab(id);
        setError(null);
        setSearchInfo(null);
      }}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-2.5 text-[13.5px] font-semibold transition-colors",
        tab === id ? "border-[var(--color-copper)] text-[var(--color-text)]" : "border-transparent text-[var(--color-text-faint)] hover:text-[var(--color-text)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count > 0 ? <span className="rounded-full bg-[var(--color-copper)] px-1.5 text-[10.5px] text-white">{count}</span> : null}
    </button>
  );

  const shown = tab === "companies" ? companies : people;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="lusha-prospect-panel">
      <div className="surface-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <LushaMark className="h-5 w-5" />
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">Filters</h2>
        </div>
        <div className="flex border-b border-[var(--color-border)]">
          {tabButton("contacts", "Contacts", UserRound, 0)}
          {tabButton("companies", "Companies", Building2, 0)}
        </div>

        <div className="divide-y divide-[var(--color-border)]">
          <CompanyFilters value={company} onChange={setCompany} showFunding={tab === "contacts"} open={open} setOpen={setOpen} />
          <ContactFilters value={contact} onChange={setContact} open={open} setOpen={setOpen} showResultOptions={tab === "contacts"} />
        </div>

        <div className="space-y-3 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] p-4">
          <label className="block space-y-1 text-[12.5px] font-semibold text-[var(--color-text)]">
            How many results
            <select className="input-field w-full text-[13px]" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((n) => (
                <option key={n} value={n}>{n} {tab === "companies" ? "companies" : "people"}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void search()}
            disabled={!canSearch || searching}
            className="btn-primary inline-flex w-full items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? "Searching…" : estimate !== null ? `Search (up to ${estimate} credit${estimate === 1 ? "" : "s"})` : "Search"}
          </button>
          <p className="text-[11.5px] text-[var(--color-text-faint)]">
            {rate
              ? `Your Lusha plan prices a search at ${rate.credits} credit${rate.credits === 1 ? "" : "s"} per ${rate.perQuantity} results, so this is the most it can cost. The exact charge is shown after the search. Adding people is free; revealing an email or phone is charged separately.`
              : "The cost shown is the most this search can charge. The exact charge is shown after the search. Adding people is free; revealing an email or phone is charged separately."}
          </p>
          {error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</p> : null}
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        {!shown && !searching ? (
          <div className="surface-card flex flex-col items-center gap-2 px-6 py-14 text-center text-[13px] text-[var(--color-text-muted)]">
            {tab === "companies" ? <Building2 className="h-6 w-6" /> : <Users className="h-6 w-6" />}
            <p>Pick some filters on the left, then search. Nothing is charged until you do.</p>
          </div>
        ) : null}

        {tab === "companies" && companies ? (
          <div className="surface-card overflow-hidden" data-testid="lusha-company-results">
            <div className="border-b border-[var(--color-border)] px-4 py-3 text-[12.5px] text-[var(--color-text-muted)]">
              {companies.length === 0
                ? "No companies matched. Try fewer or broader filters. Lusha still charges 1 credit for a search that finds nothing."
                : `Showing ${companies.length} of ${searchInfo?.total.toLocaleString() ?? "many"} matches · ${searchInfo?.creditsCharged ?? 0} credit${searchInfo?.creditsCharged === 1 ? "" : "s"} charged for this search`}
            </div>
            {companies.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all companies"
                        checked={companies.length > 0 && companies.every((c) => pickedCompanies.has(c.id))}
                        onChange={(e) => setPickedCompanies(e.target.checked ? new Set(companies.map((c) => c.id)) : new Set())}
                      />
                    </th>
                    <th className="px-4 py-2.5">Company</th>
                    <th className="px-4 py-2.5">Industry</th>
                    <th className="px-4 py-2.5">Employees</th>
                    <th className="px-4 py-2.5">Location</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          checked={pickedCompanies.has(c.id)}
                          onChange={(e) =>
                            setPickedCompanies((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-[var(--color-text)]">{c.name}</span>
                        {c.domain ? <span className="block text-[11.5px] text-[var(--color-text-faint)]">{c.domain}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{c.industry || "—"}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{c.employees || "—"}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{c.location || "—"}</td>
                      <td className="px-4 py-2.5">
                        {c.linkedin ? (
                          <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" aria-label={`${c.name} on LinkedIn`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            ) : null}
            {pickedCompanies.size > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
                <span className="text-[13px] font-semibold text-[var(--color-text)]">{pickedCompanies.size} selected</span>
                <button type="button" onClick={findPeopleAtPicked} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold">
                  <Users className="h-4 w-4" />
                  Find people at {pickedCompanies.size === 1 ? "this company" : "these companies"}
                </button>
                <p className="text-[12px] text-[var(--color-text-muted)]">Opens the Contacts tab with these companies filled in. Nothing is charged until you search.</p>
              </div>
            ) : null}
          </div>
        ) : null}

      {result ? (
        <div className="surface-card space-y-1 p-5 text-[13px]" data-testid="lusha-prospect-result">
          <p className="font-semibold text-[var(--color-text)]">
            Added {result.added} {result.added === 1 ? "person" : "people"} to your contacts.
          </p>
          {result.skippedAlreadyThere.length > 0 ? (
            <p className="text-[var(--color-text-muted)]">Already in your contacts, skipped: {result.skippedAlreadyThere.join(", ")}</p>
          ) : null}
          {result.reveal ? (
            <p className="text-[var(--color-text-muted)]">
              Lusha found details for {result.reveal.found}; {result.reveal.updated} contact{result.reveal.updated === 1 ? "" : "s"} updated. {result.reveal.creditsCharged} credit{result.reveal.creditsCharged === 1 ? "" : "s"} charged.
            </p>
          ) : null}
          {result.revealBlocked ? <p className="text-[var(--color-warning)]">Their email and phone were not revealed: {result.revealBlocked}</p> : null}
        </div>
      ) : null}

      {tab === "contacts" && people ? (
        <div className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 text-[12.5px] text-[var(--color-text-muted)]">
            <span>
              {people.length === 0
                ? `No one matched. Try a broader title or another company. Lusha still charges 1 credit for a search that finds nothing.${company.locations.length > 0 ? " Tip: \"HQ company location\" is where a company's head office is, so it hides companies headquartered elsewhere. To find people who live in a country, use the location under Contact filters instead." : ""}`
                : `Showing ${people.length} of ${searchInfo?.total.toLocaleString() ?? "many"} matches · ${searchInfo?.creditsCharged ?? 0} credit${searchInfo?.creditsCharged === 1 ? "" : "s"} charged for this search`}
            </span>
          </div>

          {people.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select everyone"
                      checked={people.length > 0 && people.every((p) => picked.has(p.id))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(people.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Title</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.fullName}`}
                        checked={picked.has(p.id)}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--color-text)]">
                      {p.fullName}
                      {p.inContactId ? <span className="ml-2 rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-muted)]">In contacts</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{p.title || "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{p.company || "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{p.location || "—"}</td>
                    <RevealedCell person={revealed[p.id]} values={shownValues(p, "emails")} field="emails" />
                    <RevealedCell person={revealed[p.id]} values={shownValues(p, "phones")} field="phones" />
                    <td className="px-4 py-2.5">
                      {p.linkedin ? (
                        <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" title="LinkedIn" aria-label={`${p.fullName} on LinkedIn`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : null}

          {pickedPeople.length > 0 ? (
            <div className="space-y-3 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                <span className="font-semibold text-[var(--color-text)]">{pickedPeople.length} selected</span>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={revealEmails} onChange={(e) => setRevealEmails(e.target.checked)} />
                  Email
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={revealPhones} onChange={(e) => setRevealPhones(e.target.checked)} />
                  Phone
                </label>
                <button
                  type="button"
                  onClick={() => void reveal()}
                  disabled={revealing || (!revealEmails && !revealPhones) || missing.length === 0}
                  className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
                >
                  {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {revealing ? "Revealing…" : missing.length > 0 && revealEstimate === 0 ? "Show (no charge)" : revealEstimate > 0 ? `Reveal (up to ${revealEstimate} credit${revealEstimate === 1 ? "" : "s"})` : "Reveal"}
                </button>
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {!revealEmails && !revealPhones
                    ? "Tick email and/or phone to reveal them here. 1 credit per email, 5 per phone, only when Lusha finds one."
                    : missing.length === 0
                      ? "Everything you ticked is already showing in the table."
                      : revealEstimate === 0
                        ? "Your Lusha account has already paid for these, so showing them costs no credits."
                        : "Charged only for what Lusha finds."}
                </span>
              </div>
              {revealNote ? <p className="text-[12px] text-[var(--color-text-muted)]">{revealNote}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={adding || chosen.length === 0}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
                >
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {adding ? "Adding…" : chosen.length > 0 ? `Add ${chosen.length} to contacts` : "Already in contacts"}
                </button>
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  Adding people costs no credits and saves any email or phone you&apos;ve revealed with them.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      </div>
    </div>
  );
}


/** A revealed email or phone in the results table, or a quiet dash while nothing has been revealed. */
function RevealedCell({ person, values, field }: { person: Shown | undefined; values: string[]; field: "emails" | "phones" }) {
  if (values.length > 0) {
    const Icon = field === "emails" ? Mail : Phone;
    return (
      <td className="px-4 py-2.5 text-[var(--color-text)]">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
          {field === "emails" ? (
            <a href={`mailto:${values[0]}`} className="hover:underline">{values[0]}</a>
          ) : (
            <span>{values[0]}</span>
          )}
          {values.length > 1 ? <span className="text-[11px] text-[var(--color-text-faint)]">+{values.length - 1}</span> : null}
        </span>
      </td>
    );
  }
  return (
    <td className="px-4 py-2.5 text-[var(--color-text-faint)]">
      {person && (field === "emails" ? person.askedEmails : person.askedPhones) ? "Not found" : "—"}
    </td>
  );
}
