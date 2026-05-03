"use client";

import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { useReveal } from "@/components/landing/useReveal";

function WindowChrome({
  url,
  children,
  className,
  emphasized,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
  /** Center column: stronger frame like the live Extraction page. */
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-zinc-50 shadow-lg shadow-zinc-900/5 ring-1 ring-black/5 dark:border-zinc-700/90 dark:bg-zinc-900 dark:shadow-black/30 dark:ring-white/5",
        emphasized &&
          "z-10 border-emerald-200/60 shadow-2xl shadow-emerald-900/10 ring-2 ring-emerald-500/20 dark:border-emerald-800/40 dark:shadow-emerald-950/20 dark:ring-emerald-500/15",
        className
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-200/80 bg-zinc-100/90 px-2.5 dark:border-zinc-800 dark:bg-zinc-800/80">
        <span className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-red-400/90" />
          <span className="h-2 w-2 rounded-full bg-amber-400/90" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/90" />
        </span>
        <div className="min-w-0 flex-1 rounded-md bg-white/90 px-2 py-0.5 text-center text-[10px] font-medium text-zinc-500 shadow-sm dark:bg-zinc-950/80 dark:text-zinc-400">
          <span className="block truncate">{url}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-2.5 dark:bg-zinc-950">
        {children}
      </div>
    </div>
  );
}

/** Mirrors Extraction: stats, badges, search, results table (see `app/dashboard` + `ResultsTable`). */
function PreviewExtraction() {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50">
          {titleCase("Extraction")}
        </p>
        <p className="text-[8px] text-zinc-500 dark:text-zinc-400">
          {titleCase("Extract from Gmail · Export CSV")}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[
          { n: "128", l: "Names", c: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
          { n: "54", l: "Phones", c: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
          { n: "203", l: "Emails", c: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300" },
        ].map((s) => (
          <div key={s.l} className={cn("rounded-lg px-1 py-1 text-center", s.c)}>
            <p className="text-[10px] font-bold tabular-nums">{s.n}</p>
            <p className="text-[7px] font-medium opacity-90">{titleCase(s.l)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-0.5">
        <span className="rounded bg-emerald-100 px-1 py-0.5 text-[7px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          {titleCase("42 contacts")}
        </span>
        <span className="rounded bg-blue-100 px-1 py-0.5 text-[7px] font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
          {titleCase("54 phones")}
        </span>
      </div>
      <div className="rounded border border-zinc-200 bg-zinc-50/80 px-1.5 py-1 text-[8px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50">
        {titleCase("Search results…")}
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-[8px]">
          <thead className="border-b border-zinc-200 bg-zinc-50/90 text-[7px] font-medium tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th className="px-1 py-1 font-medium">{titleCase("Subject")}</th>
              <th className="px-1 py-1 font-medium">{titleCase("Sender")}</th>
              <th className="px-1 py-1 font-medium">{titleCase("Contacts")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            <tr>
              <td className="max-w-[72px] truncate px-1 py-1 font-medium text-zinc-900 dark:text-zinc-100">
                {titleCase("Re: drive on Fri")}
              </td>
              <td className="max-w-[64px] truncate px-1 py-1 text-zinc-600 dark:text-zinc-400">
                talent@co.com
              </td>
              <td className="px-1 py-1 align-top">
                <div className="rounded border border-zinc-200/80 bg-zinc-50/80 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">Priya N.</p>
                  <p className="text-zinc-500">priya@…</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Mirrors Mail: Inbox/Sent, thread list (see `app/inbox`). */
function PreviewMail() {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50">{titleCase("Mail")}</p>
          <p className="text-[8px] text-zinc-500 dark:text-zinc-400">
            {titleCase("Inbox & sent · compose")}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[7px] font-semibold text-white">
          {titleCase("Compose")}
        </span>
      </div>
      <div className="flex gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
        <span className="flex-1 rounded bg-emerald-50 py-1 text-center text-[7px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {titleCase("Inbox")}
        </span>
        <span className="flex-1 py-1 text-center text-[7px] text-zinc-500">{titleCase("Sent")}</span>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {[
          { name: "R. Kapoor", subj: "JD: Backend role — remote", t: "10:42" },
          { name: "S. Lee", subj: "Re: Interview slots next week", t: "Yesterday" },
        ].map((row, i) => (
          <li key={i} className="flex gap-1.5 py-1.5 first:pt-0">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200/80 text-[8px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {row.name[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-1">
                <p className="truncate text-[8px] font-semibold text-zinc-900 dark:text-zinc-100">{row.name}</p>
                <time className="shrink-0 text-[7px] text-zinc-400">{row.t}</time>
              </div>
              <p className="truncate text-[8px] text-zinc-600 dark:text-zinc-300">{row.subj}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mirrors CRM: funnel column + lead card (see `app/crm`). */
function PreviewCrm() {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50">{titleCase("CRM")}</p>
        <p className="text-[8px] text-zinc-500 dark:text-zinc-400">
          {titleCase("Pipeline · staff view · kanban")}
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-1.5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mb-1 flex items-center justify-between px-0.5">
          <span className="text-[8px] font-semibold text-zinc-800 dark:text-zinc-200">
            {titleCase("Awareness")}
          </span>
          <span className="rounded-full bg-zinc-200 px-1 py-0 text-[7px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            5
          </span>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-1 flex items-center justify-between">
            <span className="rounded-full border border-red-200 bg-red-50 px-1 py-0 text-[6px] font-bold uppercase text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-400">
              Hot
            </span>
          </div>
          <p className="text-[8px] font-semibold text-zinc-900 dark:text-zinc-100">Acme Staffing Ltd</p>
          <p className="mt-0.5 text-[7px] text-zinc-500">Ananya · ananya@…</p>
          <p className="mt-1 border-t border-zinc-100 pt-1 text-[6px] text-zinc-400 dark:border-zinc-800">
            {titleCase("Staff: you · move stage…")}
          </p>
        </div>
      </div>
      <div className="flex gap-0.5 text-[6px] text-zinc-400">
        <span className="rounded border border-dashed border-zinc-200 px-1 py-0.5 dark:border-zinc-700">
          {titleCase("Engagement")}
        </span>
        <span className="rounded border border-dashed border-zinc-200 px-1 py-0.5 dark:border-zinc-700">
          {titleCase("Conversion")}
        </span>
      </div>
    </div>
  );
}

export function ProductPreviews() {
  const { ref: rootRef, visible: show } = useReveal<HTMLDivElement>();

  const col = (className?: string) =>
    cn(
      "transition-all duration-700 ease-out motion-reduce:transition-none",
      show ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
      className
    );

  return (
    <div ref={rootRef} className="w-full">
      <div className="mx-auto grid max-w-xl grid-cols-1 gap-5 sm:max-w-none md:grid-cols-3 md:items-end md:gap-4 lg:gap-6">
        {/* Mail — left on md+, second on mobile */}
        <div
          className={col("order-2 flex min-h-[280px] md:order-1 md:min-h-[300px] md:pb-2")}
          style={{ transitionDelay: show ? "60ms" : "0ms" }}
        >
          <WindowChrome url="placecom.app/inbox">
            <PreviewMail />
          </WindowChrome>
        </div>

        {/* Extraction — center, slightly raised on md+ */}
        <div
          className={col(
            "order-1 flex min-h-[300px] md:order-2 md:min-h-[320px] md:-translate-y-3 md:scale-[1.03] md:pb-0"
          )}
        >
          <WindowChrome url="placecom.app/dashboard" emphasized>
            <PreviewExtraction />
          </WindowChrome>
        </div>

        {/* CRM — right on md+, third on mobile */}
        <div
          className={col("order-3 flex min-h-[280px] md:order-3 md:min-h-[300px] md:pb-2")}
          style={{ transitionDelay: show ? "120ms" : "0ms" }}
        >
          <WindowChrome url="placecom.app/crm">
            <PreviewCrm />
          </WindowChrome>
        </div>
      </div>
    </div>
  );
}
