"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { pathToFeature } from "@/lib/feature-access";
import {
  IconMail,
  IconFolder,
  IconDashboard,
  IconCalendar,
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
      <div className="border-b border-[var(--color-border)] nucleus-backdrop">
        <div className="mx-auto flex h-[56px] max-w-6xl items-center justify-between gap-3 px-4">
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
              className="flex items-center gap-2.5 leading-none"
              aria-label="The Nucleus — home"
            >
              <PlacecomLogo />
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {me?.sessionEmail ? (
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  className="flex max-w-[min(100vw-8rem,260px)] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-offset)]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--nucleus-bright)] to-[var(--nucleus-core)] text-xs font-semibold text-white shadow-sm">
                    {(me.displayUsername || me.sessionEmail).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden min-w-0 flex-1 flex-col text-left text-[13px] leading-tight sm:flex">
                    <span className="truncate font-medium text-[var(--color-text)]">
                      {me.displayUsername || me.sessionEmail.split("@")[0]}
                    </span>
                    <span className="truncate text-[11px] text-[var(--color-text-muted)]">{me.sessionEmail}</span>
                  </span>
                  <IconChevronDown
                    className={cn(
                      "hidden h-4 w-4 shrink-0 text-[var(--color-text-faint)] transition-transform sm:block",
                      userMenuOpen && "rotate-180",
                    )}
                  />
                </button>
                {userMenuOpen ? (
                  <div
                    role="menu"
                    className="animate-slide-down absolute right-0 top-full z-50 mt-1.5 w-[min(calc(100vw-2rem),17rem)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
                  >
                    <div className="border-b border-[var(--color-border)] px-3 py-2.5">
                      <p className="truncate text-xs font-semibold text-[var(--color-text)]" title={me.sessionEmail}>
                        {me.displayUsername || me.sessionEmail}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]" title={me.sessionEmail}>
                        {me.sessionEmail}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
                        {titleCase(`Role · ${me.role}`)}
                      </p>
                      {me.mailboxEmail ? (
                        <p
                          className="mt-2 truncate text-[11px] text-[var(--color-primary)]"
                          title={me.mailboxEmail}
                        >
                          Mail: {me.mailboxEmail}
                        </p>
                      ) : me.role !== "admin" ? (
                        <p className="mt-2 text-[11px] text-[var(--color-warning)]">
                          {titleCase("Mail: not linked to admin")}
                        </p>
                      ) : me.role === "admin" && !me.hasStoredMailbox ? (
                        <p className="mt-2 text-[11px] text-[var(--color-warning)]">
                          {titleCase("Open any page once to save mailbox session")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]"
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
            className="animate-backdrop-in fixed inset-0 z-40 bg-[#0d1021]/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="animate-drawer-in fixed inset-y-0 left-0 z-50 flex w-[min(21rem,85vw)] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nav-sidebar-title"
          >
            <div className="flex min-h-[3.5rem] shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
              <PlacecomLogo />
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] hover:scale-110 active:scale-90"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <p
              id="nav-sidebar-title"
              className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-faint)]"
            >
              {titleCase("Navigation")}
            </p>
            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
              {links.map((l, idx) => {
                const Icon = l.icon;
                const active = isNavActive(l.href, pathname, searchParams);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    prefetch
                    onClick={() => setMobileOpen(false)}
                    style={{ animationDelay: `${idx * 35}ms` }}
                    className={cn(
                      "animate-slide-in-left mx-1 flex min-h-11 items-center gap-3.5 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-all duration-150 active:scale-[0.98]",
                      active
                        ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] shadow-sm"
                        : "text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] hover:translate-x-[2px]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex w-6 shrink-0 justify-center transition-transform duration-200",
                        active ? "text-[var(--color-primary)] scale-110" : "text-[var(--color-text-muted)] group-hover:scale-105",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.5 : 2} />
                    </span>
                    <span className="truncate">{titleCase(l.label)}</span>
                    {active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                    )}
                  </Link>
                );
              })}
              <div className="mx-3 my-2 border-t border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => void signOut()}
                className="mx-1 flex min-h-11 items-center gap-3.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-[var(--color-danger)] transition-all duration-150 hover:bg-[var(--color-danger-light)] active:scale-[0.98]"
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
          <div className="h-[56px] border-b border-[var(--color-border)] nucleus-backdrop" />
        </header>
      }
    >
      <AppHeaderInner />
    </Suspense>
  );
}
