"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Folder,
  Kanban,
  Mail,
  Megaphone,
  Menu,
  MessageCircle,
  Sparkles,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { pathToFeature } from "@/lib/feature-access";

const adminLink = { href: "/admin/team", label: "Team", Icon: Users } as const;

const primaryNav = [
  { href: "/inbox", label: "Mail", Icon: Mail },
  { href: "/dashboard", label: "Extraction", Icon: Sparkles },
  { href: "/crm", label: "CRM", Icon: Kanban },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/meetings", label: "Meetings", Icon: FileText },
] as const;

const secondaryNav = [
  { href: "/drive", label: "Drive", Icon: Folder },
  { href: "/forms", label: "Forms", Icon: ClipboardList },
  { href: "/broadcasting", label: "Broadcasting", Icon: Megaphone },
  { href: "/sms", label: "SMS", Icon: Smartphone },
  { href: "/whatsapp", label: "WhatsApp", Icon: MessageCircle },
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

function workspacePageTitle(pathname: string): string {
  if (pathname.startsWith("/admin")) return titleCase("Team");
  if (pathname.startsWith("/inbox")) return titleCase("Mail");
  if (pathname.startsWith("/dashboard")) return titleCase("Extraction");
  if (pathname.startsWith("/crm")) return titleCase("CRM");
  if (pathname.startsWith("/calendar")) return titleCase("Calendar");
  if (pathname.startsWith("/meetings")) return titleCase("Meetings");
  if (pathname.startsWith("/drive")) return titleCase("Drive");
  if (pathname.startsWith("/forms")) return titleCase("Forms");
  if (pathname.startsWith("/broadcasting")) return titleCase("Broadcasting");
  if (pathname.startsWith("/sms")) return titleCase("SMS");
  if (pathname.startsWith("/whatsapp")) return titleCase("WhatsApp");
  return titleCase("The Nucleus");
}

function WorkspaceChromeInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [me, setMe] = useState<MeMailboxResponse | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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
    const secondaryFiltered = secondaryNav.filter((l) => {
      if (me?.role !== "committee") return true;
      const feature = pathToFeature(l.href, searchParams);
      return feature ? !restricted.has(feature) : true;
    });
    const primaryFiltered = primaryNav.filter((l) => {
      if (me?.role !== "committee") return true;
      const feature = pathToFeature(l.href, searchParams);
      return feature ? !restricted.has(feature) : true;
    });
    const admin =
      me?.role === "admin"
        ? adminLink
        : null;
    return { primary: primaryFiltered, secondary: secondaryFiltered, admin };
  }, [me?.role, me?.restrictedFeatures, searchParams]);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const displayName = me?.displayUsername || me?.sessionEmail?.split("@")[0] || "User";
  const email = me?.sessionEmail || "";
  const initials = (displayName || email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const pageTitle = workspacePageTitle(pathname);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-[56px] font-body md:pb-0">
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[230px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        <div className="flex h-[56px] shrink-0 items-center border-b border-[var(--color-border)] px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="The Nucleus — home">
            <PlacecomLogo />
          </Link>
        </div>
        <nav className="scrollbar-thin flex flex-1 flex-col gap-0.5 overflow-y-auto py-3">
          {links.primary.map(({ href, label, Icon }) => {
            const active = isNavActive(href, pathname, searchParams);
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={cn(
                  "relative mx-2 flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-2.5 text-[14px] font-medium transition-colors",
                  active
                    ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)] before:absolute before:left-0 before:top-1/2 before:h-[60%] before:w-[2.5px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--color-primary)] before:content-['']"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 opacity-90" strokeWidth={2} />
                <span className="truncate">{titleCase(label)}</span>
              </Link>
            );
          })}
          <div className="mx-4 my-3 border-t border-[var(--color-border)]" />
          <p className="mb-1 px-6 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
            {titleCase("Workspace")}
          </p>
          {links.secondary.map(({ href, label, Icon }) => {
            const active = isNavActive(href, pathname, searchParams);
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={cn(
                  "relative mx-2 flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)] before:absolute before:left-0 before:top-1/2 before:h-[60%] before:w-[2.5px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--color-primary)] before:content-['']"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
                )}
              >
                <Icon className="h-[17px] w-[17px] shrink-0 opacity-90" strokeWidth={2} />
                <span className="truncate">{titleCase(label)}</span>
              </Link>
            );
          })}
          {links.admin ? (
            <Link
              href={links.admin.href}
              prefetch
              className={cn(
                "relative mx-2 mt-1 flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-2 text-[13px] font-medium transition-colors",
                pathname.startsWith(links.admin.href)
                  ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)] before:absolute before:left-0 before:top-1/2 before:h-[60%] before:w-[2.5px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--color-primary)] before:content-['']"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
              )}
            >
              <links.admin.Icon className="h-[17px] w-[17px] shrink-0 opacity-90" strokeWidth={2} />
              <span className="truncate">{titleCase(links.admin.label)}</span>
            </Link>
          ) : null}
        </nav>
        <div className="shrink-0 border-t border-[var(--color-border)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--nucleus-bright)] to-[var(--nucleus-core)] text-[12px] font-bold text-white shadow-sm">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[var(--color-text)]">{displayName}</p>
              {email ? (
                <p className="truncate text-[12px] text-[var(--color-text-muted)]" title={email}>
                  {email}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-2 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)]"
              >
                {titleCase("Sign out")}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Top header */}
      <header className="fixed left-0 right-0 top-0 z-30 flex h-[56px] items-center justify-between border-b border-[var(--color-border)] nucleus-backdrop px-4 md:left-[230px] md:px-6">
        <h1 className="font-display text-[18px] font-bold tracking-tight text-[var(--color-text)]">{pageTitle}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-[calc(100vh-56px)] px-4 pb-4 pt-[calc(56px+12px)] md:ml-[230px] md:px-6 md:pb-6 md:pt-[calc(56px+16px)]">
        {children}
      </main>

      {/* Mobile bottom bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex h-[56px] items-center justify-around border-t border-[var(--color-border)] bg-[var(--color-surface)] px-1 md:hidden"
        aria-label="Primary navigation"
      >
        {links.primary.slice(0, 5).map(({ href, Icon }) => {
          const active = isNavActive(href, pathname, searchParams);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                active ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]" : "text-[var(--color-text-muted)]",
              )}
            >
              <Icon className="h-[20px] w-[20px]" strokeWidth={2} />
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)]"
          aria-label="More navigation"
        >
          <Menu className="h-[20px] w-[20px]" strokeWidth={2} />
        </button>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#0d1021]/45 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-md)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[15px] font-bold">{titleCase("More")}</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-[var(--radius-md)] p-2 hover:bg-[var(--color-surface-offset)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            {links.primary.slice(5).map(({ href, label, Icon }) => {
              const active = isNavActive(href, pathname, searchParams);
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "mb-1 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-[14px] font-medium",
                    active ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]" : "text-[var(--color-text)]",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  {titleCase(label)}
                </Link>
              );
            })}
            <div className="my-2 border-t border-[var(--color-border)] pt-2">
              {links.secondary.map(({ href, label, Icon }) => {
                const active = isNavActive(href, pathname, searchParams);
                return (
                  <Link
                    key={href}
                    href={href}
                    prefetch
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "mb-1 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-[14px]",
                      active ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]" : "text-[var(--color-text-muted)]",
                    )}
                  >
                    <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
                    {titleCase(label)}
                  </Link>
                );
              })}
              {links.admin ? (
                <Link
                  href={links.admin.href}
                  prefetch
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "mb-1 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-[14px]",
                    pathname.startsWith(links.admin.href)
                      ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                      : "text-[var(--color-text-muted)]",
                  )}
                >
                  <links.admin.Icon className="h-[17px] w-[17px]" strokeWidth={2} />
                  {titleCase(links.admin.label)}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-bg)] pt-[52px]" />}>
      <WorkspaceChromeInner>{children}</WorkspaceChromeInner>
    </Suspense>
  );
}
