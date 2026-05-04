"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import {
  IconMail,
  IconDashboard,
  IconCalendar,
  IconPhone,
  IconSettings,
  IconLogOut,
  IconMenu,
  IconX,
  IconUser,
  IconUsers,
} from "@/components/Icons";

const baseLinks = [
  { href: "/inbox", label: "Mail", icon: IconMail },
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/crm", label: "CRM", icon: IconUser },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/calls", label: "Calls", icon: IconPhone },
  { href: "/meetings", label: "Meetings", icon: IconCalendar },
  { href: "/settings", label: "Settings", icon: IconSettings },
] as const;

const adminLink = { href: "/admin/team", label: "Team", icon: IconUsers } as const;

export function AppHeader() {
  const pathname = usePathname();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<MeMailboxResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/mailbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MeMailboxResponse | null) => {
        if (!cancelled && j) setMe(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const links =
    me?.role === "admin" ? [...baseLinks, adminLink] : [...baseLinks];

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/70 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              G
            </span>
            <span className="hidden sm:inline">Gmail Extractor</span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex">
            {links.map((l) => {
              const Icon = l.icon;
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "btn-ghost gap-1.5 text-[13px]",
                    active &&
                      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 opacity-70" />
                  {titleCase(l.label)}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          {me?.sessionEmail ? (
            <div className="hidden min-w-0 max-w-[220px] text-right text-[11px] leading-snug text-zinc-500 lg:block dark:text-zinc-400">
              <div className="truncate font-medium text-zinc-700 dark:text-zinc-200" title={me.sessionEmail}>
                {me.displayUsername ? `${me.displayUsername}` : me.sessionEmail}
              </div>
              {me.mailboxEmail ? (
                <div
                  className="truncate text-emerald-700 dark:text-emerald-400"
                  title={me.mailboxEmail}
                >
                  Mail: {me.mailboxEmail}
                </div>
              ) : me.role === "staff" ? (
                <div className="truncate text-amber-700 dark:text-amber-400">
                  Mail: not linked to admin
                </div>
              ) : me.role === "admin" && !me.hasStoredMailbox ? (
                <div className="truncate text-amber-700 dark:text-amber-400">
                  Open any page once to save mailbox session
                </div>
              ) : null}
            </div>
          ) : null}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut()}
            className="btn-ghost hidden gap-1.5 text-[13px] sm:inline-flex"
          >
            <IconLogOut className="h-3.5 w-3.5 opacity-70" />
            {titleCase("Sign out")}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="btn-ghost md:hidden"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-zinc-200/80 bg-white px-4 pb-4 pt-2 dark:border-zinc-800/80 dark:bg-zinc-950 md:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((l) => {
              const Icon = l.icon;
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "btn-ghost justify-start gap-2 py-2.5",
                    active &&
                      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Icon className="h-4 w-4 opacity-70" />
                  {titleCase(l.label)}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => void signOut()}
              className="btn-ghost justify-start gap-2 py-2.5 text-red-600 dark:text-red-400"
            >
              <IconLogOut className="h-4 w-4 opacity-70" />
              {titleCase("Sign out")}
            </button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
