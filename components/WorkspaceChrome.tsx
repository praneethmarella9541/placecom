"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  Contact,
  FileSpreadsheet,
  HardDrive,
  Inbox,
  LogOut,
  Menu,
  MessagesSquare,
  Rss,
  ScanText,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { runLoginPrefetchChain } from "@/lib/workspace-feature-prefetch";
import { cn } from "@/lib/utils";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { pathToFeature } from "@/lib/feature-access";
import { titleCase } from "@/lib/title-case";
import { ContactPhotoProvider } from "@/components/ContactPhotoProvider";
import { ExtractionRunProvider } from "@/components/ExtractionRunProvider";
import { ExtractionRunBanner } from "@/components/ExtractionRunBanner";
import { GmailAvatar } from "@/components/GmailAvatar";
import { formatPhone } from "@/lib/wa-contacts-display";

/* ─── nav config ──────────────────────────────────────────── */
const adminLink = { href: "/admin/team", label: "Team", Icon: Users } as const;

const primaryNav = [
  { href: "/inbox",     label: "Mail",       Icon: Inbox },
  { href: "/dashboard", label: "Extraction", Icon: ScanText },
  { href: "/crm",       label: "CRM",        Icon: Contact },
  { href: "/calendar",  label: "Calendar",   Icon: Calendar },
  { href: "/meetings",  label: "Meetings",   Icon: Video },
] as const;

const secondaryNav = [
  { href: "/drive",        label: "Drive",        Icon: HardDrive },
  { href: "/forms",        label: "Forms",        Icon: FileSpreadsheet },
  { href: "/broadcasting", label: "Broadcasting", Icon: Rss },
  { href: "/whatsapp",     label: "WhatsApp",     Icon: MessagesSquare },
  { href: "/contacts",     label: "Contacts",     Icon: UserRound },
] as const;

/* ─── helpers ─────────────────────────────────────────────── */
function isNavActive(href: string, pathname: string, searchParams: URLSearchParams): boolean {
  if (href.includes("?")) {
    const [path, qs] = href.split("?");
    if (pathname !== path) return false;
    const want = new URLSearchParams(qs);
    let match = true;
    want.forEach((v, k) => { if (searchParams.get(k) !== v) match = false; });
    return match;
  }
  if (href === "/broadcasting") {
    return pathname === "/broadcasting";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ─── NavItem ─────────────────────────────────────────────── */
function NavItem({
  href,
  label,
  Icon,
  active,
  size = "md",
  onClick,
}: {
  href: string;
  label: string;
  Icon: React.ElementType;
  active: boolean;
  size?: "md" | "sm";
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 transition-all duration-150",
        size === "md" ? "py-2.5 text-[13.5px]" : "py-2 text-[13px]",
        active
          ? "bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-text)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
          : "font-medium text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--color-text)]",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-[58%] w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
      )}
      <Icon
        className={cn(
          "shrink-0 transition-colors duration-150",
          size === "md" ? "h-[17px] w-[17px]" : "h-[16px] w-[16px]",
          active
            ? "text-[var(--color-primary)]"
            : "text-[var(--sidebar-text-faint)] group-hover:text-[var(--color-text-muted)]",
        )}
        strokeWidth={active ? 2.5 : 2}
      />
      <span className="truncate leading-normal">{label}</span>
    </Link>
  );
}

/* ─── UserProfile ─────────────────────────────────────────── */
function UserProfile({
  displayName,
  email,
  me,
  onSignOut,
}: {
  displayName: string;
  email: string;
  me: MeMailboxResponse | null;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150",
          open
            ? "bg-[var(--sidebar-hover)]"
            : "hover:bg-[var(--sidebar-hover)]",
        )}
      >
        <div className="relative shrink-0">
          <GmailAvatar seed={email} name={displayName} email={email} isMe size={32} />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--sidebar-bg)] bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-[var(--color-text)]">
            {displayName}
          </p>
          <p className="truncate text-[11px] leading-tight text-[var(--sidebar-text-faint)]" title={email}>
            {email}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--sidebar-text-faint)] transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="animate-slide-down absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="truncate text-[12px] font-semibold text-[var(--color-text)]">{displayName}</p>
            <p className="truncate text-[11px] text-[var(--color-text-faint)]">{email}</p>
            {me?.mailboxEmail && (
              <p className="mt-1.5 truncate text-[10px] text-[var(--color-text-faint)]" title={me.mailboxEmail}>
                <span className="text-[var(--color-text-muted)]">{titleCase("Mailbox")}: </span>
                {me.mailboxEmail}
              </p>
            )}
            {me?.exotelVirtualNumber && (
              <p className="mt-0.5 truncate text-[10px] text-[var(--color-text-faint)]" title={me.exotelVirtualNumber}>
                <span className="text-[var(--color-text-muted)]">{titleCase("Line")}: </span>
                {formatPhone(me.exotelVirtualNumber)}
              </p>
            )}
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]"
          >
            <Contact className="h-3.5 w-3.5" />
            {titleCase("My profile")}
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); onSignOut(); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-light)]"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Sidebar ─────────────────────────────────────────────── */
function Sidebar({
  links,
  pathname,
  searchParams,
  displayName,
  email,
  me,
  onSignOut,
  onClick,
}: {
  links: { primary: typeof primaryNav[number][]; secondary: typeof secondaryNav[number][]; admin: typeof adminLink | null };
  pathname: string;
  searchParams: URLSearchParams;
  displayName: string;
  email: string;
  me: MeMailboxResponse | null;
  onSignOut: () => void;
  onClick?: () => void;
}) {
  return (
    <aside className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--sidebar-border)] px-4">
        <Link href="/inbox" aria-label="The Nucleus — home">
          <PlacecomLogo />
        </Link>
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin flex flex-1 flex-col overflow-y-auto px-2 py-1">
        {/* Primary */}
        <div className="flex flex-col gap-0.5">
          {links.primary.map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              active={isNavActive(href, pathname, searchParams)}
              onClick={onClick}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="my-3 px-2">
          <div className="h-px bg-[var(--sidebar-border)]" />
        </div>

        {/* Secondary */}
        <div className="flex flex-col gap-0.5">
          {links.secondary.map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              active={isNavActive(href, pathname, searchParams)}
              size="sm"
              onClick={onClick}
            />
          ))}
          {links.admin && (
            <NavItem
              href={links.admin.href}
              label={links.admin.label}
              Icon={links.admin.Icon}
              active={pathname.startsWith(links.admin.href)}
              size="sm"
              onClick={onClick}
            />
          )}
        </div>

        <div className="flex-1" />
      </nav>

      {/* User profile footer */}
      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2 py-2">
        <UserProfile
          displayName={displayName}
          email={email}
          me={me}
          onSignOut={onSignOut}
        />
      </div>
    </aside>
  );
}

/* ─── Main component ──────────────────────────────────────── */
function WorkspaceChromeInner({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname();
  const searchParams = useSearchParams();
  const supabase   = createClient();

  const [me, setMe]             = useState<MeMailboxResponse | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* fetch me */
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/mailbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MeMailboxResponse | null) => { if (!cancelled && j) setMe(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* Warm mail + drive, then WhatsApp → Calendar → Forms once mailbox is linked. */
  useEffect(() => {
    if (!me?.hasStoredMailbox) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void runLoginPrefetchChain({
        restrictedFeatures: me.restrictedFeatures,
        signal: ac.signal,
        mailConcurrency: 3,
        driveConcurrency: 2,
      });
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [me?.hasStoredMailbox, me?.restrictedFeatures]);

  /* close mobile drawer on navigation */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  /* lock body scroll when drawer open */
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  const links = useMemo(() => {
    const restricted = new Set(me?.restrictedFeatures ?? []);
    const filter = <T extends { href: string }>(arr: readonly T[]) =>
      arr.filter((l) => {
        if (me?.role !== "committee") return true;
        const feature = pathToFeature(l.href, searchParams);
        return feature ? !restricted.has(feature) : true;
      });
    return {
      primary:   filter(primaryNav) as typeof primaryNav[number][],
      secondary: filter(secondaryNav) as typeof secondaryNav[number][],
      admin:     me?.role === "admin" ? adminLink : null,
    };
  }, [me?.role, me?.restrictedFeatures, searchParams]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const displayName = me?.displayUsername || me?.sessionEmail?.split("@")[0] || "User";
  const email       = me?.sessionEmail || "";
  const sidebarProps = { links, pathname, searchParams, displayName, email, me, onSignOut: () => void signOut() };

  return (
    <ExtractionRunProvider>
    <ContactPhotoProvider>
    <div className="flex min-h-screen bg-[var(--color-bg)]">

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside
        className="workspace-sidebar fixed inset-y-0 left-0 z-40 hidden w-[220px] border-r md:block"
        aria-label="Main navigation"
      >
        <Sidebar {...sidebarProps} />
      </aside>

      {/* ── Mobile header bar ─────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--color-border)] nucleus-backdrop px-4 pt-[env(safe-area-inset-top,0px)] md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] active:scale-90"
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
        <Link href="/inbox" className="flex-1">
          <PlacecomLogo />
        </Link>
      </header>

      {/* ── Mobile drawer overlay ─────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            className="animate-backdrop-in absolute inset-0 bg-[var(--color-text)]/20 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="workspace-sidebar animate-drawer-in absolute inset-y-0 left-0 w-[min(280px,85vw)] border-r shadow-[var(--shadow-lg)] pb-[env(safe-area-inset-bottom,0px)]"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3.5 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-all hover:bg-[var(--sidebar-hover)] hover:text-[var(--color-text)] active:scale-90"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            <Sidebar {...sidebarProps} onClick={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────── */}
      <main
        key={pathname}
        className={cn(
          "flex-1 min-w-0 animate-fade-up min-h-screen overflow-hidden",
          // Desktop: push right of sidebar, with generous padding
          "md:ml-[220px] md:px-6 md:py-6",
          // Mobile: account for top header + side padding
          "pt-[calc(56px+16px+env(safe-area-inset-top,0px))] px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] md:pt-6 md:pb-6",
        )}
        style={{ animationDuration: "0.25s" }}
      >
        {children}
      </main>
      <ExtractionRunBanner />
    </div>
    </ContactPhotoProvider>
    </ExtractionRunProvider>
  );
}

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-[var(--color-bg)]">
          <div className="workspace-sidebar hidden w-[220px] shrink-0 border-r md:block" />
          <div className="flex-1" />
        </div>
      }
    >
      <WorkspaceChromeInner>{children}</WorkspaceChromeInner>
    </Suspense>
  );
}
