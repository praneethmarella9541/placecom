"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { LushaMark } from "@/components/LushaLogo";
import { Building2, CalendarClock, ExternalLink, Loader2, MapPin, Phone, Plus, Minus, Search, UserPlus, UserRound, Users, Briefcase, Armchair } from "lucide-react";
import { SuggestListInput, type SuggestionItem } from "@/components/SuggestListInput";
import { SuggestChipsInput } from "@/components/SuggestChipsInput";
import {
  JOB_CHANGE_OPTIONS,
  LUSHA_DATA_POINTS,
  LUSHA_DEPARTMENTS,
  LUSHA_SENIORITY,
} from "@/lib/integrations/lusha-filters";
import { JOB_TITLE_SUGGESTIONS } from "@/lib/integrations/job-title-suggestions";
import type { ProspectPerson } from "@/app/api/integrations/lusha/prospect/route";
import { cn } from "@/lib/utils";

const SIZES = [10, 25, 50];

type AddResult = {
  added: number;
  skippedAlreadyThere: string[];
  reveal: { found: number; updated: number; creditsCharged: number } | null;
  revealBlocked: string | null;
};

async function suggestFromLusha(field: "companies" | "locations", term: string): Promise<SuggestionItem[]> {
  const res = await fetch(`/api/integrations/lusha/suggest?field=${field}&q=${encodeURIComponent(term)}`);
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as { values?: SuggestionItem[] };
  return json.values ?? [];
}
const suggestCompanies = (term: string) => suggestFromLusha("companies", term);
const suggestLocations = (term: string) => suggestFromLusha("locations", term);
const suggestTitles = async (term: string) => {
  const t = term.toLowerCase();
  return JOB_TITLE_SUGGESTIONS.filter((x) => x.toLowerCase().includes(t))
    .slice(0, 8)
    .map((x) => ({ label: x, value: x }));
};

function toggled<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** One collapsible filter row: icon, title, how many choices are set, and a +/- toggle. */
function Section({
  id,
  icon: Icon,
  title,
  count,
  open,
  setOpen,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  open: Set<string>;
  setOpen: (next: Set<string>) => void;
  children: React.ReactNode;
}) {
  const isOpen = open.has(id);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(toggled(open, id))}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]"
      >
        <Icon className="h-4 w-4 text-[var(--color-copper)]" />
        <span className="flex-1 text-[13.5px] font-semibold text-[var(--color-text)]">{title}</span>
        {count > 0 ? <span className="rounded-full bg-[var(--color-copper)] px-2 py-0.5 text-[11px] font-semibold text-white">{count}</span> : null}
        {isOpen ? <Minus className="h-4 w-4 text-[var(--color-text-muted)]" /> : <Plus className="h-4 w-4 text-[var(--color-text-muted)]" />}
      </button>
      {isOpen ? <div className="space-y-2 px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function splitList(v: string): string[] {
  return v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Find people at a company by job title with the workspace's Lusha account, and add the ones you
 * want to the contact book.
 *
 * Lusha charges for every result a search returns, so the size you pick is the most a search can
 * cost and is shown on the button. Adding people costs nothing; revealing their email or phone is
 * optional, per person, and priced beforehand.
 */
export function LushaProspectPanel({ onAdded }: { onAdded: () => void }) {
  const [companies, setCompanies] = useState("");
  const [titles, setTitles] = useState("");
  const [names, setNames] = useState("");
  const [locations, setLocations] = useState<SuggestionItem[]>([]);
  const [departments, setDepartments] = useState<Set<string>>(new Set());
  const [seniority, setSeniority] = useState<Set<number>>(new Set());
  const [dataPoints, setDataPoints] = useState<Set<string>>(new Set());
  const [dataAll, setDataAll] = useState(false);
  const [jobChangeDays, setJobChangeDays] = useState(0);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["company", "title"]));
  const [size, setSize] = useState(25);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<ProspectPerson[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<{ total: number; creditsCharged: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [revealEmails, setRevealEmails] = useState(false);
  const [revealPhones, setRevealPhones] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);

  const canSearch =
    splitList(companies).length + splitList(titles).length + splitList(names).length + locations.length + departments.size + seniority.size > 0;

  // The most a search can charge, shown before it runs. Only needs the page size, so it is cheap.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations/lusha/prospect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: ["probe.com"], size, dryRun: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { estimatedCredits?: number };
        if (live) setEstimate(res.ok ? (json.estimatedCredits ?? null) : null);
      } catch {
        if (live) setEstimate(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [size]);

  async function search() {
    if (!canSearch || searching) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/lusha/prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: splitList(companies),
          jobTitles: splitList(titles),
          names: splitList(names),
          locations: locations.map((l) => JSON.parse(l.value)),
          departments: [...departments],
          seniorityIds: [...seniority],
          existingDataPoints: [...dataPoints],
          existingDataPointsAll: dataAll,
          jobChangedAfterDate: jobChangeDays
            ? new Date(Date.now() - jobChangeDays * 86_400_000).toISOString().slice(0, 10)
            : undefined,
          size,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { people?: ProspectPerson[]; total?: number; creditsCharged?: number; error?: string };
      if (!res.ok) {
        setError(json.error || "Lusha couldn't complete that search.");
        return;
      }
      setPeople(json.people ?? []);
      setSearchInfo({ total: json.total ?? 0, creditsCharged: json.creditsCharged ?? 0 });
      setPicked(new Set());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSearching(false);
    }
  }

  const addable = useMemo(() => (people ?? []).filter((p) => !p.inContactId), [people]);
  const chosen = useMemo(() => addable.filter((p) => picked.has(p.id)), [addable, picked]);
  const revealEstimate = useMemo(
    () =>
      chosen.reduce(
        (sum, p) => sum + (revealEmails ? (p.revealCost.emails ?? 1) : 0) + (revealPhones ? (p.revealCost.phones ?? 5) : 0),
        0,
      ),
    [chosen, revealEmails, revealPhones],
  );

  async function add() {
    if (chosen.length === 0 || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/prospect/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          people: chosen.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, title: p.title, company: p.company, location: p.location, linkedin: p.linkedin })),
          reveal: [...(revealEmails ? ["emails"] : []), ...(revealPhones ? ["phones"] : [])],
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

  const inputClass = "input-field w-full text-[13px]";

  return (
    <div className="space-y-5" data-testid="lusha-prospect-panel">
      <div className="surface-card space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-[var(--color-text)]">
            <LushaMark className="h-5 w-5" />
            Find people with Lusha
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-muted)]">
            Narrow down by company, location, job title, department and more, then add the people you want to your contact book.
          </p>
        </div>

        <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          <p className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Companies</p>
          <Section id="company" icon={Building2} title="Company name" count={splitList(companies).length} open={openSections} setOpen={setOpenSections}>
            <SuggestListInput className={inputClass} value={companies} onChange={setCompanies} placeholder="Acme, tcs.com" getSuggestions={suggestCompanies} />
            <span className="block text-[11.5px] text-[var(--color-text-faint)]">Names or website addresses. Separate several with commas.</span>
          </Section>

          <p className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Contacts</p>
          <Section id="details" icon={Phone} title="Contact details" count={dataPoints.size} open={openSections} setOpen={setOpenSections}>
            <p className="text-[12px] text-[var(--color-text-muted)]">Only people Lusha has these for:</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {LUSHA_DATA_POINTS.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={dataPoints.has(d.id)} onChange={() => setDataPoints((prev) => toggled(prev, d.id))} />
                  {d.label}
                </label>
              ))}
            </div>
            {dataPoints.size > 1 ? (
              <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
                <input type="checkbox" checked={dataAll} onChange={(e) => setDataAll(e.target.checked)} />
                Must have all of these (otherwise any one is enough)
              </label>
            ) : null}
          </Section>
          <Section id="location" icon={MapPin} title="Contact location" count={locations.length} open={openSections} setOpen={setOpenSections}>
            <SuggestChipsInput chips={locations} onChange={setLocations} placeholder="A country, state or city" getSuggestions={suggestLocations} />
          </Section>
          <Section id="title" icon={Briefcase} title="Job title" count={splitList(titles).length} open={openSections} setOpen={setOpenSections}>
            <SuggestListInput className={inputClass} value={titles} onChange={setTitles} placeholder="Talent Acquisition, HR Manager" getSuggestions={suggestTitles} />
          </Section>
          <Section id="name" icon={UserRound} title="Contact name" count={splitList(names).length} open={openSections} setOpen={setOpenSections}>
            <input className={inputClass} value={names} onChange={(e) => setNames(e.target.value)} placeholder="Priya Sharma, Rahul Mehta" />
          </Section>
          <Section id="department" icon={Users} title="Department" count={departments.size} open={openSections} setOpen={setOpenSections}>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {LUSHA_DEPARTMENTS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={departments.has(d)} onChange={() => setDepartments((prev) => toggled(prev, d))} />
                  {d}
                </label>
              ))}
            </div>
          </Section>
          <Section id="seniority" icon={Armchair} title="Seniority" count={seniority.size} open={openSections} setOpen={setOpenSections}>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {LUSHA_SENIORITY.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={seniority.has(d.id)} onChange={() => setSeniority((prev) => toggled(prev, d.id))} />
                  {d.label}
                </label>
              ))}
            </div>
          </Section>
          <Section id="jobchange" icon={CalendarClock} title="Job change" count={jobChangeDays ? 1 : 0} open={openSections} setOpen={setOpenSections}>
            <select className={inputClass} value={jobChangeDays} onChange={(e) => setJobChangeDays(Number(e.target.value))}>
              <option value={0}>Any time</option>
              {JOB_CHANGE_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </select>
            <span className="block text-[11.5px] text-[var(--color-text-faint)]">People who started a new job in that time. Use it together with another filter.</span>
          </Section>
        </div>

        <label className="block max-w-xs space-y-1 text-[12.5px] font-semibold text-[var(--color-text)]">
          How many results
          <select className={inputClass} value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {SIZES.map((n) => (
              <option key={n} value={n}>{n} people</option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void search()}
            disabled={!canSearch || searching}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? "Searching…" : estimate !== null ? `Search (up to ${estimate} credits)` : "Search"}
          </button>
          <p className="text-[12px] text-[var(--color-text-faint)]">Lusha charges for each result it shows, so the number of results is the most a search can cost.</p>
        </div>

        {error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</p> : null}
      </div>

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

      {people ? (
        <div className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 text-[12.5px] text-[var(--color-text-muted)]">
            <span>
              {people.length === 0
                ? "No one matched. Try a broader title or another company."
                : `Showing ${people.length} of ${searchInfo?.total.toLocaleString() ?? "many"} matches · ${searchInfo?.creditsCharged ?? 0} credits charged for this search`}
            </span>
          </div>

          {people.length > 0 ? (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select everyone who isn't already a contact"
                      checked={addable.length > 0 && addable.every((p) => picked.has(p.id))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(addable.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Title</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className={cn("border-b border-[var(--color-border)] last:border-b-0", p.inContactId && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        disabled={!!p.inContactId}
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
          ) : null}

          {chosen.length > 0 ? (
            <div className="space-y-3 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                <span className="font-semibold text-[var(--color-text)]">{chosen.length} selected</span>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={revealEmails} onChange={(e) => setRevealEmails(e.target.checked)} />
                  Also find their email
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={revealPhones} onChange={(e) => setRevealPhones(e.target.checked)} />
                  Also find their phone
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void add()} disabled={adding} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60">
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {adding ? "Adding…" : `Add ${chosen.length} to contacts`}
                </button>
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  {revealEstimate > 0 ? `Revealing could use up to ${revealEstimate} more credits.` : "Adding people costs no credits."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
