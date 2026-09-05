"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookText,
  Calendar,
  ChevronDown,
  ChevronLeft,
  Contact,
  FileText,
  Folder,
  Frame,
  KanbanSquare,
  LogOut,
  Mail,
  MessageCircle,
  Phone,
  Radio,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { prefetchAdminTeamData } from "@/lib/admin-team-prefetch";
import { clearSecondaryFeaturePrefetchCache } from "@/lib/workspace-feature-prefetch";
import { pathToFeature } from "@/lib/feature-access";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { PlacecomLogo, PlacecomMark } from "@/components/PlacecomLogo";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { clearMeMailboxCache, useMeMailbox } from "@/lib/use-me-mailbox";
import { GmailAvatar } from "@/components/GmailAvatar";
import { formatPhone } from "@/lib/wa-contacts-display";

const adminLink = { href: "/admin/team", label: "Team", Icon: Users } as const;

const commsNav = [
  { href: "/inbox", label: "Mail", Icon: Mail },
  { href: "/whatsapp", label: "WhatsApp", Icon: MessageCircle },
  { href: "/calls", label: "Calls", Icon: Phone },
  { href: "/broadcasting", label: "Broadcasting", Icon: Radio },
  { href: "/sequences", label: "Sequences", Icon: Workflow },
  { href: "/contacts", label: "Contacts", Icon: UserRound },
] as const;

const pipelineNav: readonly { href: string; label: string; Icon: React.ElementType }[] = [
  { href: "/crm", label: "CRM", Icon: KanbanSquare },
];

const opsNav = [
  { href: "/drive", label: "Drive", Icon: Folder },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
  { href: "/forms", label: "Forms", Icon: FileText },
  { href: "/sheets", label: "Sheets", Icon: Frame },
  { href: "/docs", label: "Docs", Icon: BookText },
] as const;

/** Sidebar nav regrouped into Comms / Pipeline / Ops — also used by WorkspaceChrome for the breadcrumb. */
export const workspaceNavGroups = [
  { label: "Comms", items: commsNav },
  { label: "Pipeline", items: pipelineNav },
  { label: "Ops", items: opsNav },
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
  collapsed,
  onClick,
  onMouseEnter,
  onNavigateStart,
}: {
  href: string;
  label: string;
  Icon: React.ElementType;
  selected: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onNavigateStart?: (href: string) => void;
}) {
  const router = useRouter();

  const testId = `nav-${href.replace(/^\//, "").replace(/\//g, "-") || "home"}`;

  return (
    <a
      href={href}
      data-testid={testId}
      title={collapsed ? label : undefined}
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
        "group relative flex cursor-pointer items-center rounded-[10px] py-2 text-[13.5px] select-none",
        collapsed ? "justify-center px-0" : "gap-[11px] px-3",
        selected
          ? "font-semibold text-[var(--sidebar-active-text)]"
          : "font-medium text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--color-text)]",
      )}
    >
      {selected && (
        <span className="absolute left-0 top-1/2 h-[58%] w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--sidebar-active-text)]" />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          selected
            ? "text-[var(--sidebar-active-text)]"
            : "text-[var(--sidebar-text-faint)] group-hover:text-[var(--color-text-muted)]",
        )}
        strokeWidth={1.75}
      />
      {!collapsed && <span className="truncate leading-normal">{label}</span>}
    </a>
  );
});

function UserProfile({
  displayName,
  email,
  me,
  collapsed,
  onSignOut,
}: {
  displayName: string;
  email: string;
  me: MeMailboxResponse | null;
  collapsed?: boolean;
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
        data-testid="user-menu"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={collapsed ? displayName : undefined}
        className={cn(
          "flex w-full items-center rounded-xl text-left",
          collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2.5",
          open ? "bg-[var(--sidebar-hover)]" : "hover:bg-[var(--sidebar-hover)]",
        )}
      >
        <div className="relative shrink-0">
          <GmailAvatar seed={email} name={displayName} email={email} isMe copper twoLetterInitials size={32} />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--sidebar-bg)] bg-emerald-500" />
        </div>
        {!collapsed && (
          <>
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
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "animate-slide-down absolute overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
            collapsed ? "bottom-0 left-full ml-2 w-56" : "bottom-full left-0 right-0 mb-1",
          )}
        >
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
            data-testid="nav-profile"
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)]"
          >
            <Contact className="h-3.5 w-3.5" />
            {titleCase("My profile")}
          </Link>
          <button
            data-testid="signout-btn"
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

function NavSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-[11px] rounded-[10px] px-3 py-2">
          <div className="h-[18px] w-[18px] shrink-0 animate-pulse rounded bg-[var(--sidebar-border)]" />
          <div
            className="h-3 animate-pulse rounded bg-[var(--sidebar-border)]"
            style={{ width: `${[58, 44, 66, 50, 60, 48][i % 6]}%` }}
          />
        </div>
      ))}
    </div>
  );
}

type NavGroupLinks = { label: string; items: { href: string; label: string; Icon: React.ElementType }[] };

const SidebarPanel = memo(function SidebarPanel({
  groups,
  pathname,
  pendingHref,
  displayName,
  email,
  me,
  meLoaded,
  collapsed,
  onToggleCollapse,
  onSignOut,
  onClick,
  onAdminHover,
  onNavigateStart,
}: {
  groups: NavGroupLinks[];
  pathname: string;
  pendingHref: string | null;
  displayName: string;
  email: string;
  me: MeMailboxResponse | null;
  meLoaded: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSignOut: () => void;
  onClick?: () => void;
  onAdminHover?: () => void;
  onNavigateStart: (href: string) => void;
}) {
  return (
    <aside className="relative flex h-full flex-col">
      {onToggleCollapse && (
        <button
          type="button"
          data-testid="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-[26px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] shadow-[var(--shadow-sm)] transition-all hover:bg-[var(--sidebar-hover)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft
            className={cn("h-3.5 w-3.5 transition-transform duration-200", collapsed && "rotate-180")}
            strokeWidth={2}
          />
        </button>
      )}

      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-[var(--sidebar-border)]",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Link href="/inbox" prefetch aria-label="The Nucleus — home">
          {collapsed ? <PlacecomMark size={24} /> : <PlacecomLogo />}
        </Link>
      </div>

      {!meLoaded ? (
        // No profile data yet (first-ever load, no cache). Show a ghost of the
        // nav rather than a blank column, so it never looks stuck.
        <nav className="scrollbar-thin flex flex-1 flex-col gap-[18px] overflow-y-auto px-[10px] py-3.5" aria-hidden>
          <NavSkeleton rows={4} />
          <NavSkeleton rows={2} />
          <NavSkeleton rows={4} />
        </nav>
      ) : (
      <nav className="scrollbar-thin flex flex-1 flex-col gap-[18px] overflow-y-auto px-[10px] py-3.5">
        {groups.map((group) =>
          group.items.length ? (
            <div key={group.label}>
              {!collapsed && (
                <p className="font-mono mb-1.5 ml-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sidebar-text-whisper)]">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ href, label, Icon }) => (
                  <NavItem
                    key={href}
                    href={href}
                    label={label}
                    Icon={Icon}
                    selected={navItemSelected(href, pathname, pendingHref)}
                    collapsed={collapsed}
                    onClick={onClick}
                    onMouseEnter={href === adminLink.href ? onAdminHover : undefined}
                    onNavigateStart={onNavigateStart}
                  />
                ))}
              </div>
            </div>
          ) : null,
        )}

        <div className="flex-1" />
      </nav>
      )}

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2.5 py-2.5">
        <UserProfile displayName={displayName} email={email} me={me} collapsed={collapsed} onSignOut={onSignOut} />
      </div>
    </aside>
  );
});

type Props = {
  onCloseMobile?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  onCloseMobile,
  collapsed,
  onToggleCollapse,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { me } = useMeMailbox();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    for (const { href } of [...commsNav, ...pipelineNav, ...opsNav, adminLink]) {
      router.prefetch(href);
    }
  }, [router]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    onCloseMobile?.();
  }, [pathname, onCloseMobile]);

  const groups = useMemo<NavGroupLinks[]>(() => {
    const restricted = new Set(me?.restrictedFeatures ?? []);
    const allowedEnv = process.env.NEXT_PUBLIC_ALLOWED_FEATURES;
    const allowed = allowedEnv?.trim()
      ? new Set(allowedEnv.split(",").map((s) => s.trim()))
      : null;
    const emptySearch = new URLSearchParams();
    const filter = (arr: readonly { href: string; label: string; Icon: React.ElementType }[]) =>
      arr.filter((l) => {
        const feature = pathToFeature(l.href, emptySearch);
        if (!feature) return true;
        if (allowed && !allowed.has(feature)) return false;
        return !restricted.has(feature);
      });
    const result = workspaceNavGroups.map((group) => ({
      label: group.label,
      items: filter(group.items),
    }));
    if (me?.role === "admin") {
      result[result.length - 1].items = [...result[result.length - 1].items, adminLink];
    }
    return result;
  }, [me?.role, me?.restrictedFeatures]);

  const signOut = useCallback(async () => {
    clearSecondaryFeaturePrefetchCache();
    clearMeMailboxCache();
    // Pause an in-progress mailbox sync before the session goes away — this needs
    // a valid session, so it has to happen ahead of signOut(). Without it the run
    // is left "idle with a cursor", which the next login treats as resumable and
    // silently restarts; pausing makes the next session ask first. No-ops when
    // there's nothing in flight (the handler only pauses a run that has a cursor),
    // and is time-boxed so a slow request can't hold up signing out.
    await fetch("/api/directory-contacts/sync", {
      method: "DELETE",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
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
      groups={groups}
      pathname={pathname}
      pendingHref={pendingHref}
      displayName={displayName}
      email={email}
      me={me}
      meLoaded={me !== null}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      onSignOut={() => void signOut()}
      onClick={onCloseMobile}
      onAdminHover={me?.role === "admin" ? () => void prefetchAdminTeamData() : undefined}
      onNavigateStart={onNavigateStart}
    />
  );
});
