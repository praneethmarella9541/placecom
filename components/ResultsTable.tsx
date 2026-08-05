"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import type { GroupedContact } from "@/lib/contact-grouping";
import { IconSearch, IconUser, IconPhone, IconAtSign, IconUsers } from "@/components/Icons";

export type ResultRow = {
  id: string;
  subject: string | null;
  sender: string | null;
  names: string[];
  phones: string[];
  emails: string[];
  contacts: GroupedContact[];
};

type Props = { rows: ResultRow[]; className?: string };

const PAGE_SIZE = 25;

export function ResultsTable({ rows, className }: Props) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const contactHay = r.contacts
        .map((c) => [c.name, c.email, c.phone].filter(Boolean).join(" "))
        .join(" ");
      const hay = [
        r.subject,
        r.sender,
        contactHay,
        ...r.names,
        ...r.phones,
        ...r.emails,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [q, rows.length]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const totals = useMemo(() => {
    let names = 0,
      phones = 0,
      emails = 0,
      contacts = 0;
    for (const r of rows) {
      names += r.names.length;
      phones += r.phones.length;
      emails += r.emails.length;
      contacts += r.contacts.length;
    }
    return { names, phones, emails, contacts };
  }, [rows]);

  const summaryItems = [
    {
      icon: IconUsers,
      value: totals.contacts,
      label: titleCase("Contacts"),
      iconWrap: "bg-[var(--color-copper)]/15 text-[var(--color-copper)]",
    },
    {
      icon: IconUser,
      value: totals.names,
      label: titleCase("Names"),
      iconWrap: "bg-[var(--color-copper)]/10 text-[var(--color-copper-hover)]",
    },
    {
      icon: IconPhone,
      value: totals.phones,
      label: titleCase("Phones"),
      iconWrap: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    },
    {
      icon: IconAtSign,
      value: totals.emails,
      label: titleCase("Emails"),
      iconWrap: "bg-[var(--color-copper)]/20 text-[var(--color-copper-hover)]",
    },
  ] as const;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm sm:shrink-0">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={titleCase("Search results…")}
            className="input-field w-full pl-9"
            type="search"
            aria-label={titleCase("Search results")}
          />
        </div>
        {filtered.length > 0 ? (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
            {titleCase("Showing")}{" "}
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}{" "}
            {titleCase("of")} {filtered.length.toLocaleString()}
            {q.trim() ? ` (${rows.length.toLocaleString()} total)` : ""}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-[var(--card)] shadow-sm dark:border-zinc-800">
        <div
          className="border-b border-zinc-200 bg-zinc-50/90 px-3 py-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:px-4 sm:py-5"
          aria-label={titleCase("Extraction totals")}
        >
          <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {titleCase("Totals across loaded messages")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {summaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex flex-col items-center justify-center rounded-xl border border-zinc-200/90 bg-white px-2 py-4 text-center shadow-sm dark:border-zinc-700/80 dark:bg-zinc-950/80 sm:py-4"
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      item.iconWrap
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
                    {item.value.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{item.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50/80 text-xs font-medium tracking-wide text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3.5">{titleCase("Subject")}</th>
              <th className="px-4 py-3.5">{titleCase("Sender")}</th>
              <th className="min-w-[240px] px-4 py-3.5">{titleCase("Contacts (paired)")}</th>
              <th className="px-4 py-3.5 text-zinc-400 dark:text-zinc-500">{titleCase("All names")}</th>
              <th className="min-w-[148px] px-4 py-3.5 text-zinc-400 dark:text-zinc-500">{titleCase("All phones")}</th>
              <th className="min-w-[180px] px-4 py-3.5 text-zinc-400 dark:text-zinc-500">{titleCase("All emails")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {pageRows.map((r) => (
              <tr
                key={r.id}
                className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
              >
                <td className="max-w-[200px] truncate px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  {r.subject || "—"}
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {r.sender || "—"}
                </td>
                <td className="px-4 py-3 align-top">
                  {r.contacts.length ? (
                    <ul className="space-y-2">
                      {r.contacts.map((c, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 px-2.5 py-2 text-[12px] leading-snug dark:border-zinc-700/80 dark:bg-zinc-900/40"
                        >
                          <div className="font-medium text-zinc-800 dark:text-zinc-100">
                            {c.name || (
                              <span className="font-normal text-zinc-400">{titleCase("No name")}</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                            {c.email || (
                              <span className="text-zinc-400">—</span>
                            )}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                            {c.phone || (
                              <span className="font-sans text-zinc-400">—</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {r.names.length ? (
                      r.names.map((n, i) => (
                        <span key={i} className="badge-emerald text-[11px]">
                          {n}
                        </span>
                      ))
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </div>
                </td>
                <td className="min-w-[148px] px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    {r.phones.length ? (
                      r.phones.map((p, i) => (
                        <span
                          key={i}
                          className="inline-flex max-w-full items-center whitespace-nowrap rounded-md border border-sky-200/80 bg-sky-50 px-2 py-0.5 font-mono text-[11px] tabular-nums leading-none text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200"
                          title={p}
                        >
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </div>
                </td>
                <td className="min-w-[180px] px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    {r.emails.length ? (
                      r.emails.map((em, i) => (
                        <span
                          key={i}
                          className="inline-flex max-w-full items-center whitespace-nowrap rounded-md border border-[var(--color-copper)]/25 bg-[var(--color-copper)]/10 px-2 py-0.5 text-[11px] leading-none text-[var(--color-copper-hover)]"
                          title={em}
                        >
                          {em}
                        </span>
                      ))
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <IconSearch className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p className="text-sm text-zinc-500">{titleCase("No rows match your search.")}</p>
          </div>
        ) : null}
        </div>
        {filtered.length > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="btn-ghost text-xs disabled:opacity-40"
            >
              {titleCase("Previous")}
            </button>
            <span className="text-xs text-zinc-500">
              {titleCase("Page")} {page} {titleCase("of")} {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="btn-ghost text-xs disabled:opacity-40"
            >
              {titleCase("Next")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
