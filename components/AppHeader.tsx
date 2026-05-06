"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { pathToFeature } from "@/lib/feature-access";
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
  IconMessageChat,
  IconSms,
  IconUsers,
  IconChevronDown,
} from "@/components/Icons";

const adminLink = { href: "/admin/team", label: "Team", icon: IconUsers } as const;

const baseLinks = [
  { href: "/inbox", label: "Mail", icon: IconMail },
  { href: "/drive", label: "Drive", icon: IconFolder },
  { href: "/broadcasting", label: "Broadcasting", icon: IconBroadcast },
  { href: "/dashboard", label: "Extraction", icon: IconDashboard },
  { href: "/crm", label: "CRM", icon: IconUser },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/calls", label: "Calls", icon: IconPhone },
  { href: "/sms", label: "SMS", icon: IconSms },
  { href: "/whatsapp", label: "WhatsApp", icon: IconMessageChat },
  { href: "/meetings", label: "Meetings", icon: IconCalendar },
] as const;

function isNavActive(href: string, pathname: string, searchParams: URLSearchParams): boolean {
  if (href === "/broadcasting") {
    return pathname === "/broadcasting";
  }
  if (href.includes("?")) {
    const [path, qs] = href.split("?");
    if (pathname !== path) return false;
    const want = new URLSearchParams(qs);
    let match = true;
    want.forEach((v, k) => {
      if (searchParams.get(k) !== v) match = false;
    });
    return match;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AppHeaderInner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [me, setMe] = useState<MeMailboxResponse | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  const links = useMemo(() => {
    const restricted = new Set(me?.restrictedFeatures ?? []);
    return (me?.role === "admin" ? [...baseLinks, adminLink] : [...baseLinks]).filter((l) => {
      if (me?.role !== "committee") return true;
      const [path, qs = ""] = l.href.split("?");
      const feature = pathToFeature(path, new URLSearchParams(qs));
      return feature ? !restricted.has(feature) : true;
    });
  }, [me?.role, me?.restrictedFeatures]);

  /** Drawer-only nav never mounts until open, so Link prefetch does not run. Warm routes when the menu opens. */
  useEffect(() => {
    if (!mobileOpen) return;
    for (const l of links) {
      void router.prefetch(l.href);
    }
  }, [mobileOpen, router, links]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const el = userMenuRef.current;
      if (el && !el.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <header
      className={cn(
        /* No backdrop-blur on this node: backdrop-filter makes fixed descendants use this box as their containing block and clips the drawer to ~toolbar height. Blur lives only on the toolbar strip below. */
        "sticky top-0",
        mobileOpen ? "z-[100]" : "z-40",
      )}
    >
      <div className="border-b border-zinc-200/90 bg-white/90 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-[52px] max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-h-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="btn-ghost -ml-1 h-9 w-9 shrink-0 justify-center p-0"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <IconX className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white shadow-sm shadow-emerald-900/10">
                G
              </span>
              <span className="hidden sm:inline">Placecom</span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {me?.sessionEmail ? (
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  className="flex max-w-[min(100vw-8rem,260px)] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-xs font-semibold text-zinc-700 dark:from-zinc-600 dark:to-zinc-700 dark:text-zinc-100">
                    {(me.displayUsername || me.sessionEmail).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden min-w-0 flex-1 flex-col text-left text-[13px] leading-tight sm:flex">
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {me.displayUsername || me.sessionEmail.split("@")[0]}
                    </span>
                    <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{me.sessionEmail}</span>
                  </span>
                  <IconChevronDown
                    className={cn(
                      "hidden h-4 w-4 shrink-0 text-zinc-400 transition-transform sm:block",
                      userMenuOpen && "rotate-180",
                    )}
                  />
                </button>
                {userMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1.5 w-[min(calc(100vw-2rem),17rem)] rounded-xl border border-zinc-200/90 bg-white py-1 shadow-lg shadow-zinc-900/10 ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
                  >
                    <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
                      <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100" title={me.sessionEmail}>
                        {me.displayUsername || me.sessionEmail}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={me.sessionEmail}>
                        {me.sessionEmail}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {titleCase(`Role: ${me.role}`)}
                      </p>
                      {me.mailboxEmail ? (
                        <p className="mt-2 truncate text-[11px] text-emerald-700 dark:text-emerald-400" title={me.mailboxEmail}>
                          Mail: {me.mailboxEmail}
                        </p>
                      ) : me.role !== "admin" ? (
                        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                          {titleCase("Mail: not linked to admin")}
                        </p>
                      ) : me.role === "admin" && !me.hasStoredMailbox ? (
                        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                          {titleCase("Open any page once to save mailbox session")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void signOut();
                      }}
                    >
                      <IconLogOut className="h-4 w-4 opacity-70" />
                      {titleCase("Sign out")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu backdrop"
            className="fixed inset-0 z-40 bg-black/45 dark:bg-black/55"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-[min(21rem,85vw)] flex-col border-r border-zinc-200 bg-white shadow-[4px_0_10px_rgba(0,0,0,0.05)] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[4px_0_10px_rgba(0,0,0,0.35)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nav-sidebar-title"
          >
            <div className="flex min-h-[3.5rem] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-4 dark:border-zinc-700">
              <p
                id="nav-sidebar-title"
                className="text-sm font-semibold leading-none text-zinc-900 dark:text-zinc-100"
              >
                {titleCase("Navigation")}
              </p>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-3">
              {links.map((l) => {
                const Icon = l.icon;
                const active = isNavActive(l.href, pathname, searchParams);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    prefetch
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "mx-2 flex min-h-11 items-center gap-4 px-3 py-2 text-[14px] font-medium transition-colors",
                      active
                        ? "rounded-full bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : "rounded-lg text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
                    )}
                  >
                    <span className="flex w-6 shrink-0 justify-center text-zinc-500 dark:text-zinc-400">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="truncate">{titleCase(l.label)}</span>
                  </Link>
                );
              })}
              <div className="mx-3 my-2 border-t border-[#e5e7eb] dark:border-zinc-700" />
              <button
                type="button"
                onClick={() => void signOut()}
                className="mx-2 flex min-h-11 items-center gap-4 rounded-lg px-3 py-2 text-left text-[14px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <span className="flex w-6 shrink-0 justify-center">
                  <IconLogOut className="h-[18px] w-[18px] opacity-80" />
                </span>
                {titleCase("Sign out")}
              </button>
            </nav>
          </aside>
        </>
      ) : null}
    </header>
  );
}

export function AppHeader() {
  return (
    <Suspense
      fallback={
        <header className="sticky top-0 z-40">
          <div className="h-[52px] border-b border-zinc-200/90 bg-white/90 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/85" />
        </header>
      }
    >
      <AppHeaderInner />
    </Suspense>
  );
}
