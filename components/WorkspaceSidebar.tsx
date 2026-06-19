"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  Contact,
  FileSpreadsheet,
  HardDrive,
  Inbox,
  LogOut,
  MessagesSquare,
  Rss,
  ScanText,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { prefetchAdminTeamData } from "@/lib/admin-team-prefetch";
import { clearSecondaryFeaturePrefetchCache } from "@/lib/workspace-feature-prefetch";
import { pathToFeature } from "@/lib/feature-access";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { GmailAvatar } from "@/components/GmailAvatar";
import { formatPhone } from "@/lib/wa-contacts-display";

const adminLink = { href: "/admin/team", label: "Team", Icon: Users } as const;

const primaryNav = [
  { href: "/inbox", label: "Mail", Icon: Inbox },
  { href: "/dashboard", label: "Extraction", Icon: ScanText },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
] as const;

const secondaryNav = [
  { href: "/drive", label: "Drive", Icon: HardDrive },
  { href: "/forms", label: "Forms", Icon: FileSpreadsheet },
  { href: "/broadcasting", label: "Broadcasting", Icon: Rss },
  { href: "/whatsapp", label: "WhatsApp", Icon: MessagesSquare },
  { href: "/contacts", label: "Contacts", Icon: UserRound },
] as const;

function isNavActive(href: string, pathname: string): boolean {
  if (href === "/broadcasting") return pathname === "/broadcasting";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navItemSelected(href: string, pathname: string, pendingHref: string | null): boolean {
  if (pendingHref) return pendingHref === href;
  return isNavActive(href, pathname);
}

const NavItem = memo(function NavItem({
  href,
  label,
  Icon,
  selected,
  size = "md",
  onClick,
  onMouseEnter,
  onNavigateStart,
}: {
  href: string;
  label: string;
  Icon: React.ElementType;
  selected: boolean;
  size?: "md" | "sm";
  onClick?: () => void;
  onMouseEnter?: () => void;
  onNavigateStart?: (href: string) => void;
}) {
  const router = useRouter();

  return (
    <a
      href={href}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        flushSync(() => onNavigateStart?.(href));
      }}
      onClick={(e) => {
        e.preventDefault();
        onNavigateStart?.(href);
        onClick?.();
        router.push(href);
      }}
      onMouseEnter={() => {
        router.prefetch(href);
        onMouseEnter?.();
      }}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 select-none",
        size === "md" ? "py-2.5 text-[13.5px]" : "py-2 text-[13px]",
        selected
          ? "bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-text)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
          : "font-medium text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--color-text)]",
      )}
    >
      {selected && (
        <span className="absolute left-0 top-1/2 h-[58%] w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
      )}
      <Icon
        className={cn(
          "shrink-0",
          size === "md" ? "h-[17px] w-[17px]" : "h-[16px] w-[16px]",
          selected
            ? "text-[var(--color-primary)]"
            : "text-[var(--sidebar-text-faint)] group-hover:text-[var(--color-text-muted)]",
        )}
        strokeWidth={selected ? 2.5 : 2}
      />
      <span className="truncate leading-normal">{label}</span>
    </a>
  );
});

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
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
          open ? "bg-[var(--sidebar-hover)]" : "hover:bg-[var(--sidebar-hover)]",
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
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
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

const SidebarPanel = memo(function SidebarPanel({
  links,
  pathname,
  pendingHref,
  displayName,
  email,
  me,
  onSignOut,
  onClick,
  onAdminHover,
  onNavigateStart,
}: {
  links: {
    primary: (typeof primaryNav)[number][];
    secondary: (typeof secondaryNav)[number][];
    admin: typeof adminLink | null;
  };
  pathname: string;
  pendingHref: string | null;
  displayName: string;
  email: string;
  me: MeMailboxResponse | null;
  onSignOut: () => void;
  onClick?: () => void;
  onAdminHover?: () => void;
  onNavigateStart: (href: string) => void;
}) {
  return (
    <aside className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--sidebar-border)] px-4">
        <Link href="/inbox" prefetch aria-label="The Nucleus — home">
          <PlacecomLogo />
        </Link>
      </div>

      <nav className="scrollbar-thin flex flex-1 flex-col overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-0.5">
          {links.primary.map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              selected={navItemSelected(href, pathname, pendingHref)}
              onClick={onClick}
              onNavigateStart={onNavigateStart}
            />
          ))}
        </div>

        <div className="my-3 px-2">
          <div className="h-px bg-[var(--sidebar-border)]" />
        </div>

        <div className="flex flex-col gap-0.5">
          {links.secondary.map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              selected={navItemSelected(href, pathname, pendingHref)}
              size="sm"
              onClick={onClick}
              onNavigateStart={onNavigateStart}
            />
          ))}
          {links.admin && (
            <NavItem
              href={links.admin.href}
              label={links.admin.label}
              Icon={links.admin.Icon}
              selected={
                pendingHref
                  ? pendingHref === links.admin.href
                  : pathname.startsWith(links.admin.href)
              }
              size="sm"
              onClick={onClick}
              onMouseEnter={onAdminHover}
              onNavigateStart={onNavigateStart}
            />
          )}
        </div>

        <div className="flex-1" />
      </nav>

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2 py-2">
        <UserProfile displayName={displayName} email={email} me={me} onSignOut={onSignOut} />
      </div>
    </aside>
  );
});

type Props = {
  onCloseMobile?: () => void;
};

export const WorkspaceSidebar = memo(function WorkspaceSidebar({ onCloseMobile }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState<MeMailboxResponse | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

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

  useEffect(() => {
    for (const { href } of [...primaryNav, ...secondaryNav, adminLink]) {
      router.prefetch(href);
    }
  }, [router]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    onCloseMobile?.();
  }, [pathname, onCloseMobile]);

  const links = useMemo(() => {
    const restricted = new Set(me?.restrictedFeatures ?? []);
    const allowedEnv = process.env.NEXT_PUBLIC_ALLOWED_FEATURES;
    const allowed = allowedEnv?.trim()
      ? new Set(allowedEnv.split(",").map((s) => s.trim()))
      : null;
    const emptySearch = new URLSearchParams();
    const filter = <T extends { href: string }>(arr: readonly T[]) =>
      arr.filter((l) => {
        const feature = pathToFeature(l.href, emptySearch);
        if (!feature) return true;
        if (allowed && !allowed.has(feature)) return false;
        return !restricted.has(feature);
      });
    return {
      primary: filter(primaryNav) as (typeof primaryNav)[number][],
      secondary: filter(secondaryNav) as (typeof secondaryNav)[number][],
      admin: me?.role === "admin" ? adminLink : null,
    };
  }, [me?.role, me?.restrictedFeatures]);

  const signOut = useCallback(async () => {
    clearSecondaryFeaturePrefetchCache();
    await supabase.auth.signOut();
    window.location.href = "/";
  }, [supabase]);

  const onNavigateStart = useCallback((href: string) => {
    setPendingHref(href);
  }, []);

  const displayName = me?.displayUsername || me?.sessionEmail?.split("@")[0] || "User";
  const email = me?.sessionEmail || "";

  return (
    <SidebarPanel
      links={links}
      pathname={pathname}
      pendingHref={pendingHref}
      displayName={displayName}
      email={email}
      me={me}
      onSignOut={() => void signOut()}
      onClick={onCloseMobile}
      onAdminHover={me?.role === "admin" ? () => void prefetchAdminTeamData() : undefined}
      onNavigateStart={onNavigateStart}
    />
  );
});
