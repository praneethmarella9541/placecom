"use client";

import { useEffect, useState } from "react";
import type React from "react";
import {
  Armchair, Briefcase, Building2, CalendarClock, ChevronDown, ChevronRight, Cpu, DollarSign, Factory, GraduationCap, KeyRound,
  Landmark, MapPin, Minus, Phone, Plus, Settings2, TrendingUp, Users, UserRound, History, Tag,
} from "lucide-react";
import { SuggestListInput, type SuggestionItem } from "@/components/SuggestListInput";
import { SuggestChipsInput } from "@/components/SuggestChipsInput";
import {
  JOB_CHANGE_OPTIONS, LUSHA_BUSINESS_MODELS, LUSHA_COMPANY_TYPES, LUSHA_DATA_POINTS, LUSHA_DEPARTMENTS, LUSHA_FUNDING_ROUNDS,
  LUSHA_REVENUES, LUSHA_SENIORITY, LUSHA_SIZES, rangeKey, revenueLabel, sizeLabel,
} from "@/lib/integrations/lusha-filters";
import { JOB_TITLE_SUGGESTIONS } from "@/lib/integrations/job-title-suggestions";

export type CompanyFilterState = {
  companies: string;
  locations: SuggestionItem[];
  mainIndustries: Set<number>;
  subIndustries: Set<number>;
  sizes: Set<string>;
  revenues: Set<string>;
  fundingRounds: Set<string>;
  fundingIpo: boolean;
  technologies: SuggestionItem[];
  technologiesAll: boolean;
  foundedMin: string;
  foundedMax: string;
  businessModel: Set<string>;
  companyType: Set<string>;
  keywords: string;
};

export type ContactFilterState = {
  titles: string;
  previousTitles: string;
  names: string;
  skills: string;
  locations: SuggestionItem[];
  departments: Set<string>;
  seniority: Set<number>;
  dataPoints: Set<string>;
  dataAll: boolean;
  jobChangeDays: number;
  maxPerCompany: number;
  excludeDnc: boolean;
};

export const emptyCompanyFilters = (): CompanyFilterState => ({
  companies: "", locations: [], mainIndustries: new Set(), subIndustries: new Set(), sizes: new Set(), revenues: new Set(),
  fundingRounds: new Set(), fundingIpo: false, technologies: [], technologiesAll: false, foundedMin: "", foundedMax: "",
  businessModel: new Set(), companyType: new Set(), keywords: "",
});

export const emptyContactFilters = (): ContactFilterState => ({
  titles: "", previousTitles: "", names: "", skills: "", locations: [], departments: new Set(), seniority: new Set(),
  dataPoints: new Set(), dataAll: false, jobChangeDays: 0, maxPerCompany: 0, excludeDnc: false,
});

export function splitList(v: string): string[] {
  return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function toggled<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

const bandsOf = (keys: Set<string>, all: { min?: number; max?: number }[]) => all.filter((r) => keys.has(rangeKey(r)));

/** The company filters as the request body the search routes expect. */
export function companyBody(c: CompanyFilterState): Record<string, unknown> {
  return {
    companies: splitList(c.companies),
    companyLocations: c.locations.map((l) => JSON.parse(l.value)),
    mainIndustryIds: [...c.mainIndustries],
    subIndustryIds: [...c.subIndustries],
    sizes: bandsOf(c.sizes, LUSHA_SIZES),
    revenues: bandsOf(c.revenues, LUSHA_REVENUES),
    fundingRounds: [...c.fundingRounds],
    fundingIpo: c.fundingIpo,
    technologies: c.technologies.map((t) => t.value),
    technologiesAll: c.technologiesAll,
    foundedMin: c.foundedMin ? Number(c.foundedMin) : undefined,
    foundedMax: c.foundedMax ? Number(c.foundedMax) : undefined,
    businessModel: [...c.businessModel],
    companyType: [...c.companyType],
    keywords: splitList(c.keywords),
  };
}

export function contactBody(k: ContactFilterState): Record<string, unknown> {
  return {
    jobTitles: splitList(k.titles),
    previousJobTitles: splitList(k.previousTitles),
    names: splitList(k.names),
    skills: splitList(k.skills),
    locations: k.locations.map((l) => JSON.parse(l.value)),
    departments: [...k.departments],
    seniorityIds: [...k.seniority],
    existingDataPoints: [...k.dataPoints],
    existingDataPointsAll: k.dataAll,
    jobChangedAfterDate: k.jobChangeDays
      ? new Date(Date.now() - k.jobChangeDays * 86_400_000).toISOString().slice(0, 10)
      : undefined,
    maxPerCompany: k.maxPerCompany || undefined,
    excludeDnc: k.excludeDnc,
  };
}

export function companyFilterCount(c: CompanyFilterState): number {
  return (
    splitList(c.companies).length + c.locations.length + c.mainIndustries.size + c.subIndustries.size + c.sizes.size + c.revenues.size +
    c.fundingRounds.size + (c.fundingIpo ? 1 : 0) + c.technologies.length + (c.foundedMin || c.foundedMax ? 1 : 0) +
    c.businessModel.size + c.companyType.size + splitList(c.keywords).length
  );
}

export function contactFilterCount(k: ContactFilterState): number {
  return (
    splitList(k.titles).length + splitList(k.previousTitles).length + splitList(k.names).length + splitList(k.skills).length +
    k.locations.length + k.departments.size + k.seniority.size + k.dataPoints.size + (k.jobChangeDays ? 1 : 0)
  );
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

async function suggestFromLusha(field: string, term: string): Promise<SuggestionItem[]> {
  const res = await fetch(`/api/integrations/lusha/suggest?field=${field}&q=${encodeURIComponent(term)}`);
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as { values?: SuggestionItem[] };
  return json.values ?? [];
}
const suggestCompanies = (t: string) => suggestFromLusha("companies", t);
const suggestContactLocations = (t: string) => suggestFromLusha("locations", t);
const suggestCompanyLocations = (t: string) => suggestFromLusha("companyLocations", t);
const suggestTech = (t: string) => suggestFromLusha("technologies", t);
const suggestTitles = async (term: string): Promise<SuggestionItem[]> => {
  const t = term.toLowerCase();
  return JOB_TITLE_SUGGESTIONS.filter((x) => x.toLowerCase().includes(t)).slice(0, 8).map((x) => ({ label: x, value: x }));
};

// ─── One collapsible filter row ──────────────────────────────────────────────

type Icon = React.ComponentType<{ className?: string }>;

function Section({
  id, icon: Icon, title, count, open, setOpen, children,
}: {
  id: string; icon: Icon; title: string; count: number; open: Set<string>; setOpen: (next: Set<string>) => void; children: React.ReactNode;
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
        <Icon className="h-4 w-4 shrink-0 text-[var(--color-copper)]" />
        <span className="flex-1 text-[13.5px] font-semibold text-[var(--color-text)]">{title}</span>
        {count > 0 ? <span className="rounded-full bg-[var(--color-copper)] px-2 py-0.5 text-[11px] font-semibold text-white">{count}</span> : null}
        {isOpen ? <Minus className="h-4 w-4 text-[var(--color-text-muted)]" /> : <Plus className="h-4 w-4 text-[var(--color-text-muted)]" />}
      </button>
      {isOpen ? <div className="space-y-2 px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{children}</p>;
}

function Checks<T extends string | number>({
  options, selected, onToggle,
}: {
  options: { id: T; label: string }[]; selected: Set<T>; onToggle: (id: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      {options.map((o) => (
        <label key={String(o.id)} className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={selected.has(o.id)} onChange={() => onToggle(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

const inputClass = "input-field w-full text-[13px]";
const hint = "block text-[11.5px] text-[var(--color-text-faint)]";

// ─── Industries (loaded when the row is first opened) ───────────────────────

type Industry = { id: number; name: string; subs: { id: number; name: string }[] };

function IndustryPicker({ value, onChange }: { value: CompanyFilterState; onChange: (v: CompanyFilterState) => void }) {
  const [list, setList] = useState<Industry[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations/lusha/options?type=industries");
        const json = (await res.json().catch(() => ({}))) as { industries?: Industry[] };
        if (live) setList(json.industries ?? []);
      } catch {
        if (live) setList([]);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  if (list === null) return <p className="text-[12.5px] text-[var(--color-text-muted)]">Loading industries…</p>;
  if (list.length === 0) return <p className="text-[12.5px] text-[var(--color-text-muted)]">Couldn&apos;t load Lusha&apos;s industry list. Try again in a moment.</p>;
  return (
    <div className="max-h-72 space-y-0.5 overflow-auto rounded-lg border border-[var(--color-border)] p-1.5">
      {list.map((ind) => (
        <div key={ind.id}>
          <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--color-surface-2)]">
            <button type="button" aria-label={expanded.has(ind.id) ? "Hide sub-industries" : "Show sub-industries"} onClick={() => setExpanded(toggled(expanded, ind.id))}>
              {expanded.has(ind.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <label className="flex flex-1 items-center gap-2 text-[13px]">
              <input type="checkbox" checked={value.mainIndustries.has(ind.id)} onChange={() => onChange({ ...value, mainIndustries: toggled(value.mainIndustries, ind.id) })} />
              {ind.name}
            </label>
          </div>
          {expanded.has(ind.id) ? (
            <div className="ml-8 space-y-0.5 pb-1">
              {ind.subs.map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-1.5 py-0.5 text-[12.5px]">
                  <input type="checkbox" checked={value.subIndustries.has(s.id)} onChange={() => onChange({ ...value, subIndustries: toggled(value.subIndustries, s.id) })} />
                  {s.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── Company filters (shared by both tabs) ──────────────────────────────────

export function CompanyFilters({
  value, onChange, showFunding, open, setOpen,
}: {
  value: CompanyFilterState; onChange: (v: CompanyFilterState) => void; showFunding: boolean; open: Set<string>; setOpen: (n: Set<string>) => void;
}) {
  const set = (patch: Partial<CompanyFilterState>) => onChange({ ...value, ...patch });
  const s = { open, setOpen };
  return (
    <>
      <Heading>Companies</Heading>
      <Section id="co-name" icon={Building2} title="Company name" count={splitList(value.companies).length} {...s}>
        <SuggestListInput className={inputClass} value={value.companies} onChange={(companies) => set({ companies })} placeholder="Acme, tcs.com" getSuggestions={suggestCompanies} />
        <span className={hint}>Names or website addresses. Separate several with commas.</span>
      </Section>
      <Section id="co-location" icon={MapPin} title="HQ company location" count={value.locations.length} {...s}>
        <SuggestChipsInput chips={value.locations} onChange={(locations) => set({ locations })} placeholder="A country, state or city" getSuggestions={suggestCompanyLocations} />
      </Section>
      <Section id="co-industry" icon={Factory} title="Industry" count={value.mainIndustries.size + value.subIndustries.size} {...s}>
        <IndustryPicker value={value} onChange={onChange} />
      </Section>
      <Section id="co-size" icon={Users} title="Employee headcount" count={value.sizes.size} {...s}>
        <Checks options={LUSHA_SIZES.map((r) => ({ id: rangeKey(r), label: sizeLabel(r) }))} selected={value.sizes} onToggle={(id) => set({ sizes: toggled(value.sizes, id) })} />
      </Section>
      <Section id="co-revenue" icon={TrendingUp} title="Revenue" count={value.revenues.size} {...s}>
        <Checks options={LUSHA_REVENUES.map((r) => ({ id: rangeKey(r), label: revenueLabel(r) }))} selected={value.revenues} onToggle={(id) => set({ revenues: toggled(value.revenues, id) })} />
      </Section>
      {showFunding ? (
        <Section id="co-funding" icon={DollarSign} title="Funding" count={value.fundingRounds.size + (value.fundingIpo ? 1 : 0)} {...s}>
          <p className="text-[12px] text-[var(--color-text-muted)]">Latest funding round:</p>
          <Checks options={LUSHA_FUNDING_ROUNDS} selected={value.fundingRounds} onToggle={(id) => set({ fundingRounds: toggled(value.fundingRounds, id) })} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={value.fundingIpo} onChange={(e) => set({ fundingIpo: e.target.checked })} />
            Publicly traded (IPO)
          </label>
        </Section>
      ) : null}
      <Section id="co-tech" icon={Cpu} title="Technology" count={value.technologies.length} {...s}>
        <SuggestChipsInput chips={value.technologies} onChange={(technologies) => set({ technologies })} placeholder="Salesforce, HubSpot…" getSuggestions={suggestTech} />
        {value.technologies.length > 1 ? (
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
            <input type="checkbox" checked={value.technologiesAll} onChange={(e) => set({ technologiesAll: e.target.checked })} />
            Must use all of these (otherwise any one is enough)
          </label>
        ) : null}
      </Section>
      <Section id="co-founded" icon={CalendarClock} title="Year founded" count={value.foundedMin || value.foundedMax ? 1 : 0} {...s}>
        <div className="flex items-center gap-2">
          <input className={inputClass} inputMode="numeric" maxLength={4} placeholder="From" value={value.foundedMin} onChange={(e) => set({ foundedMin: e.target.value.replace(/\D/g, "") })} />
          <span className="text-[12px] text-[var(--color-text-muted)]">to</span>
          <input className={inputClass} inputMode="numeric" maxLength={4} placeholder="To" value={value.foundedMax} onChange={(e) => set({ foundedMax: e.target.value.replace(/\D/g, "") })} />
        </div>
      </Section>
      <Section id="co-model" icon={Landmark} title="Business model" count={value.businessModel.size} {...s}>
        <Checks options={LUSHA_BUSINESS_MODELS.map((b) => ({ id: b, label: b }))} selected={value.businessModel} onToggle={(id) => set({ businessModel: toggled(value.businessModel, id) })} />
      </Section>
      <Section id="co-type" icon={Tag} title="Company type" count={value.companyType.size} {...s}>
        <Checks options={LUSHA_COMPANY_TYPES.map((b) => ({ id: b, label: b }))} selected={value.companyType} onToggle={(id) => set({ companyType: toggled(value.companyType, id) })} />
      </Section>
      <Section id="co-keywords" icon={KeyRound} title="Keywords" count={splitList(value.keywords).length} {...s}>
        <input className={inputClass} value={value.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="campus hiring, recruitment" />
        <span className={hint}>Words that describe what the company does. Separate several with commas.</span>
      </Section>
    </>
  );
}

// ─── Contact filters ─────────────────────────────────────────────────────────

export function ContactFilters({
  value, onChange, open, setOpen, showResultOptions,
}: {
  value: ContactFilterState; onChange: (v: ContactFilterState) => void; open: Set<string>; setOpen: (n: Set<string>) => void;
  /** Only the people search has these. */
  showResultOptions: boolean;
}) {
  const set = (patch: Partial<ContactFilterState>) => onChange({ ...value, ...patch });
  const s = { open, setOpen };
  return (
    <>
      <Heading>Contacts</Heading>
      <Section id="ct-details" icon={Phone} title="Contact details" count={value.dataPoints.size} {...s}>
        <p className="text-[12px] text-[var(--color-text-muted)]">Only people Lusha has these for:</p>
        <Checks options={LUSHA_DATA_POINTS} selected={value.dataPoints} onToggle={(id) => set({ dataPoints: toggled(value.dataPoints, id) })} />
        {value.dataPoints.size > 1 ? (
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
            <input type="checkbox" checked={value.dataAll} onChange={(e) => set({ dataAll: e.target.checked })} />
            Must have all of these (otherwise any one is enough)
          </label>
        ) : null}
      </Section>
      <Section id="ct-location" icon={MapPin} title="Contact location" count={value.locations.length} {...s}>
        <SuggestChipsInput chips={value.locations} onChange={(locations) => set({ locations })} placeholder="A country, state or city" getSuggestions={suggestContactLocations} />
      </Section>
      <Section id="ct-title" icon={Briefcase} title="Job title" count={splitList(value.titles).length} {...s}>
        <SuggestListInput className={inputClass} value={value.titles} onChange={(titles) => set({ titles })} placeholder="Talent Acquisition, HR Manager" getSuggestions={suggestTitles} />
      </Section>
      <Section id="ct-prevtitle" icon={History} title="Previous job title" count={splitList(value.previousTitles).length} {...s}>
        <SuggestListInput className={inputClass} value={value.previousTitles} onChange={(previousTitles) => set({ previousTitles })} placeholder="Recruiter" getSuggestions={suggestTitles} />
      </Section>
      <Section id="ct-name" icon={UserRound} title="Contact name" count={splitList(value.names).length} {...s}>
        <input className={inputClass} value={value.names} onChange={(e) => set({ names: e.target.value })} placeholder="Priya Sharma, Rahul Mehta" />
      </Section>
      <Section id="ct-department" icon={Users} title="Department" count={value.departments.size} {...s}>
        <Checks options={LUSHA_DEPARTMENTS.map((d) => ({ id: d, label: d }))} selected={value.departments} onToggle={(id) => set({ departments: toggled(value.departments, id) })} />
      </Section>
      <Section id="ct-seniority" icon={Armchair} title="Seniority" count={value.seniority.size} {...s}>
        <Checks options={LUSHA_SENIORITY} selected={value.seniority} onToggle={(id) => set({ seniority: toggled(value.seniority, id) })} />
      </Section>
      <Section id="ct-skills" icon={GraduationCap} title="Skills" count={splitList(value.skills).length} {...s}>
        <input className={inputClass} value={value.skills} onChange={(e) => set({ skills: e.target.value })} placeholder="Recruiting, Sourcing" />
        <span className={hint}>Separate several with commas.</span>
      </Section>
      <Section id="ct-jobchange" icon={CalendarClock} title="Job change" count={value.jobChangeDays ? 1 : 0} {...s}>
        <select className={inputClass} value={value.jobChangeDays} onChange={(e) => set({ jobChangeDays: Number(e.target.value) })}>
          <option value={0}>Any time</option>
          {JOB_CHANGE_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>{o.label}</option>
          ))}
        </select>
        <span className={hint}>People who started a new job in that time. Use it together with another filter.</span>
      </Section>
      {showResultOptions ? (
      <Section id="ct-options" icon={Settings2} title="Result options" count={(value.maxPerCompany ? 1 : 0) + (value.excludeDnc ? 1 : 0)} {...s}>
        <label className="space-y-1 text-[12.5px] font-semibold text-[var(--color-text)]">
          People per company
          <select className={inputClass} value={value.maxPerCompany} onChange={(e) => set({ maxPerCompany: Number(e.target.value) })}>
            <option value={0}>No limit</option>
            {[1, 2, 3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>At most {n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={value.excludeDnc} onChange={(e) => set({ excludeDnc: e.target.checked })} />
          Leave out people on a do-not-call list
        </label>
      </Section>
      ) : null}
    </>
  );
}
