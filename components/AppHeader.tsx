"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  IconMail,
  IconFolder,
  IconDashboard,
  IconCalendar,
  IconPhone,
  IconLogOut,
  IconMenu,
  IconX,
  IconUser,
  IconBroadcast,
} from "@/components/Icons";

const links = [
  { href: "/inbox", label: "Mail", icon: IconMail },
  { href: "/drive", label: "Drive", icon: IconFolder },
  { href: "/broadcasting", label: "Broadcasting", icon: IconBroadcast },
  { href: "/dashboard", label: "Extraction", icon: IconDashboard },
  { href: "/crm", label: "CRM", icon: IconUser },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/calls", label: "Calls", icon: IconPhone },
  { href: "/meetings", label: "Meetings", icon: IconCalendar },
];

export function AppHeader() {
  const pathname = usePathname();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <span className="hidden sm:inline">Placecom</span>
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
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={signOut}
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
              onClick={signOut}
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
