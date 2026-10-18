"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { LushaMark } from "@/components/LushaLogo";
import type { CsvRowResult } from "@/app/api/integrations/lusha/csv/route";
import { CSV_ROLES, guessColumns, toCsv, type CsvRole } from "@/lib/integrations/csv-enrich";

const MAX_ROWS = 300;

type Parsed = { fileName: string; headers: string[]; rows: string[][] };
type Plan = { requested: number; toLookUp: number; skipped: number; skippedSample: { n: number; name: string; reason: string }[]; estimatedCredits: number };
type Outcome = { results: CsvRowResult[]; found: number; creditsCharged: number; stopped: null | { code: string; message: string } };

/**
 * Enrich a list from a file: upload a CSV or Excel sheet, say which columns are the name, company,
 * email and LinkedIn link, see what it would cost, then download the same sheet with the emails and
 * phones Lusha found. Nothing is added to the contact book.
 */
export function LushaCsvEnrich() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [cols, setCols] = useState<Record<CsvRole, number> | null>(null);
  const [emails, setEmails] = useState(true);
  const [phones, setPhones] = useState(false);
  const [reading, setReading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reveal = useMemo(() => [...(emails ? ["emails"] : []), ...(phones ? ["phones"] : [])], [emails, phones]);

  const rows = useMemo(() => {
    if (!parsed || !cols) return [];
    const get = (r: string[], role: CsvRole) => (cols[role] >= 0 ? (r[cols[role]] ?? "").trim() : "");
    return parsed.rows.map((r, n) => ({
      n,
      name: get(r, "name"),
      firstName: get(r, "firstName"),
      lastName: get(r, "lastName"),
      company: get(r, "company"),
      email: get(r, "email"),
      phone: get(r, "phone"),
      linkedin: get(r, "linkedin"),
    }));
  }, [parsed, cols]);

  async function readFile(file: File) {
    setReading(true);
    setError(null);
    setPlan(null);
    setOutcome(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/directory-contacts/import/parse", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { fileName?: string; headers?: string[]; rows?: string[][]; error?: string };
      if (!res.ok || !data.headers || !data.rows) throw new Error(data.error || "Couldn't read that file");
      setParsed({ fileName: data.fileName ?? file.name, headers: data.headers, rows: data.rows });
      setCols(guessColumns(data.headers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    } finally {
      setReading(false);
    }
  }

  // The free plan: what would be looked up, what is skipped and why, and the most it could cost.
  const tooMany = rows.length > MAX_ROWS;
  useEffect(() => {
    setPlan(null);
    setOutcome(null);
    if (rows.length === 0 || tooMany || reveal.length === 0) return;
    let live = true;
    const t = setTimeout(async () => {
      setPlanning(true);
      try {
        const res = await fetch("/api/integrations/lusha/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows, reveal, dryRun: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string };
        if (!live) return;
        if (res.ok && json.plan) {
          setPlan(json.plan);
          setError(null);
        } else setError(json.error || "Couldn't work out the plan.");
      } catch {
        if (live) setError("Could not reach the server.");
      } finally {
        if (live) setPlanning(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [rows, reveal, tooMany]);

  async function run() {
    if (!plan || plan.toLookUp === 0 || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, reveal }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Outcome> & { error?: string };
      if (!res.ok || !json.results) {
        setError(json.error || "Lusha couldn't complete that run.");
        return;
      }
      setOutcome({ results: json.results, found: json.found ?? 0, creditsCharged: json.creditsCharged ?? 0, stopped: json.stopped ?? null });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  function download() {
    if (!parsed || !outcome) return;
    const byN = new Map(outcome.results.map((r) => [r.n, r]));
    const extra = ["Lusha email", "Lusha phone", "Lusha job title", "Lusha company", "Lusha location", "Lusha LinkedIn", "Lusha status"];
    const body = parsed.rows.map((r, n) => {
      const x = byN.get(n);
      const status = !x ? "" : x.status === "found" ? "Found" : x.status === "skipped" ? `Skipped: ${x.reason}` : x.status === "not_run" ? `Not run: ${x.reason}` : `Not found${x.reason ? `: ${x.reason}` : ""}`;
      return [...r, x?.email ?? "", x?.phone ?? "", x?.title ?? "", x?.company ?? "", x?.location ?? "", x?.linkedin ?? "", status];
    });
    const blob = new Blob([toCsv([...parsed.headers, ...extra], body)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${parsed.fileName.replace(/\.[^.]+$/, "")}-enriched.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectClass = "input-field w-full text-[13px]";

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="lusha-csv-enrich">
      <div className="surface-card space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-[var(--color-text)]">
            <LushaMark className="h-5 w-5" />
            Enrich a list
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-muted)]">
            Upload a CSV or Excel file of people. Lusha finds their emails and phone numbers, and you download the same file with them added. Nothing is added to your contacts.
          </p>
        </div>

        {!parsed ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-6 py-10 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {reading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
            <span className="font-semibold text-[var(--color-text)]">{reading ? "Reading the file…" : "Choose a .csv or .xlsx file"}</span>
            <span>Up to {MAX_ROWS} people per run. Each needs a LinkedIn link, an email, or a full name with a company.</span>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-[var(--color-surface-offset)] px-4 py-3 text-[13px]">
            <FileSpreadsheet className="h-5 w-5 text-[var(--color-copper)]" />
            <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-text)]">{parsed.fileName}</span>
            <span className="text-[var(--color-text-muted)]">{parsed.rows.length} rows</span>
            <button type="button" className="text-[var(--color-copper)] hover:underline" onClick={() => { setParsed(null); setCols(null); setPlan(null); setOutcome(null); setError(null); }}>
              Choose another
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.ods"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void readFile(f);
          }}
        />

        {parsed && cols ? (
          <>
            <div>
              <p className="mb-2 text-[12.5px] font-semibold text-[var(--color-text)]">Which column is which?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CSV_ROLES.map(({ role, label }) => (
                  <label key={role} className="space-y-1 text-[12.5px] text-[var(--color-text-muted)]">
                    {label}
                    <select className={selectClass} value={cols[role]} onChange={(e) => setCols({ ...cols, [role]: Number(e.target.value) })}>
                      <option value={-1}>Not in my file</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
              <span className="font-semibold text-[var(--color-text)]">Find</span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={emails} onChange={(e) => setEmails(e.target.checked)} />
                Email addresses
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={phones} onChange={(e) => setPhones(e.target.checked)} />
                Phone numbers <span className="text-[var(--color-text-faint)]">— these cost more credits</span>
              </label>
            </div>

            {tooMany ? (
              <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">
                This file has {rows.length} rows. Use at most {MAX_ROWS} per run: split the file and enrich each part.
              </p>
            ) : reveal.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">Choose what to find.</p>
            ) : planning && !plan ? (
              <p className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Working out the plan…</p>
            ) : plan ? (
              <div className="space-y-1 rounded-lg bg-[var(--color-surface-offset)] px-4 py-3 text-[13px]" data-testid="lusha-csv-plan">
                <p><span className="font-semibold">{plan.toLookUp}</span> will be looked up with Lusha, for up to <span className="font-semibold">{plan.estimatedCredits}</span> credits.</p>
                {plan.skipped > 0 ? (
                  <details className="text-[var(--color-text-muted)]">
                    <summary className="cursor-pointer">{plan.skipped} skipped, no credits used</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {plan.skippedSample.map((s) => (
                        <li key={s.n}>Row {s.n + 2} · {s.name}: {s.reason}</li>
                      ))}
                      {plan.skipped > plan.skippedSample.length ? <li>and {plan.skipped - plan.skippedSample.length} more</li> : null}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</p> : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void run()}
                disabled={!plan || plan.toLookUp === 0 || running || !!outcome}
                className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <LushaMark className="h-4 w-4" />}
                {running ? "Finding…" : plan ? `Find now (up to ${plan.estimatedCredits} credits)` : "Find now"}
              </button>
              <p className="text-[12px] text-[var(--color-text-faint)]">The most it can cost is shown first; you are only charged for what Lusha finds.</p>
            </div>
          </>
        ) : null}
        {!parsed && error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</p> : null}
      </div>

      {outcome ? (
        <div className="surface-card space-y-3 p-5 text-[13px]" data-testid="lusha-csv-result">
          <p className="font-semibold text-[var(--color-text)]">
            Lusha found details for {outcome.found} {outcome.found === 1 ? "person" : "people"}. {outcome.creditsCharged} credit{outcome.creditsCharged === 1 ? "" : "s"} charged.
          </p>
          {outcome.stopped ? <p className="text-[var(--color-warning)]">The run stopped early: {outcome.stopped.message} Rows not reached are marked in the file.</p> : null}
          <button type="button" onClick={download} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold">
            <Download className="h-4 w-4" />
            Download the enriched file
          </button>
          <div className="overflow-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                </tr>
              </thead>
              <tbody>
                {outcome.results.slice(0, 10).map((r) => (
                  <tr key={r.n} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-3 py-1.5 text-[var(--color-text-muted)]">{r.n + 2}</td>
                    <td className="px-3 py-1.5">{r.status === "found" ? "Found" : r.status === "skipped" ? "Skipped" : r.status === "not_run" ? "Not run" : "Not found"}</td>
                    <td className="px-3 py-1.5">{r.email || "—"}</td>
                    <td className="px-3 py-1.5">{r.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outcome.results.length > 10 ? <p className="text-[12px] text-[var(--color-text-faint)]">Showing the first 10. The downloaded file has every row.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
