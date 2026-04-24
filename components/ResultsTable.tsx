"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
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

export function ResultsTable({ rows, className }: Props) {
  const [q, setQ] = useState("");

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

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-emerald gap-1">
            <IconUsers className="h-3 w-3" />
            {totals.contacts} contacts
          </span>
          <span className="badge-emerald/80 gap-1">
            <IconUser className="h-3 w-3" />
            {totals.names} names
          </span>
          <span className="badge-blue gap-1">
            <IconPhone className="h-3 w-3" />
            {totals.phones} phones
          </span>
          <span className="badge-purple gap-1">
            <IconAtSign className="h-3 w-3" />
            {totals.emails} emails
          </span>
        </div>
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search results…"
            className="input-field pl-9 sm:max-w-xs"
            type="search"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50/80 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3.5 font-medium">Subject</th>
              <th className="px-4 py-3.5 font-medium">Sender</th>
              <th className="min-w-[240px] px-4 py-3.5 font-medium">
                Contacts (paired)
              </th>
              <th className="px-4 py-3.5 font-medium text-zinc-400 dark:text-zinc-500">
                All names
              </th>
              <th className="px-4 py-3.5 font-medium text-zinc-400 dark:text-zinc-500">
                All phones
              </th>
              <th className="px-4 py-3.5 font-medium text-zinc-400 dark:text-zinc-500">
                All emails
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {filtered.map((r) => (
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
                              <span className="font-normal text-zinc-400">No name</span>
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
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {r.phones.length ? (
                      r.phones.map((p, i) => (
                        <span key={i} className="badge-blue text-[11px]">
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {r.emails.length ? (
                      r.emails.map((em, i) => (
                        <span key={i} className="badge-purple text-[11px]">
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
            <p className="text-sm text-zinc-500">No rows match your search.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
