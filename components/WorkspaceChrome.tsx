"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { TopbarActionsPortalContext } from "@/lib/workspace-topbar-context";
import { isWorkspacePrefetchSessionComplete } from "@/lib/login-prefetch-session";
import { runLoginPrefetchChain } from "@/lib/workspace-feature-prefetch";
import { prefetchAdminTeamData } from "@/lib/admin-team-prefetch";
import { cn } from "@/lib/utils";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { ContactPhotoProvider } from "@/components/ContactPhotoProvider";
import { ExtractionRunProvider } from "@/components/ExtractionRunProvider";
import { ExtractionRunBanner } from "@/components/ExtractionRunBanner";
import { WorkspaceSidebar, workspaceNavGroups } from "@/components/WorkspaceSidebar";
import { titleCase } from "@/lib/title-case";

/** Breadcrumb for the content topbar: section label + active page label, derived from the sidebar's nav groups. */
function useContentBreadcrumb(pathname: string) {
  return useMemo(() => {
    for (const group of workspaceNavGroups) {
      for (const item of group.items) {
        const active = item.href === "/broadcasting" ? pathname === "/broadcasting" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        if (active) return { group: group.label, label: item.label };
      }
    }
    // Route outside the grouped nav (e.g. /admin/team, /profile) — fall back to a generic label.
    const segment = pathname.split("/").filter(Boolean)[0] ?? "";
    return { group: "The Nucleus", label: segment ? titleCase(segment) : "" };
  }, [pathname]);
}

function ContentTopbar({
  actionsNode,
  collapsed,
}: {
  actionsNode: (node: HTMLDivElement | null) => void;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const breadcrumb = useContentBreadcrumb(pathname);

  return (
    <div
      className={cn(
        "nucleus-backdrop fixed top-0 right-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 transition-[left] duration-200 md:flex",
        collapsed ? "left-[72px]" : "left-[220px]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-display text-[16px] font-bold tracking-[-0.01em] text-[var(--color-text)]">
          {breadcrumb.group}
        </span>
        <span className="text-[var(--color-hairline)]">/</span>
        <span className="text-[14px] font-medium text-[var(--color-text-muted)]">{breadcrumb.label}</span>
      </div>
      <div ref={actionsNode} className="flex items-center gap-2.5" />
    </div>
  );
}

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [actionsPortalNode, setActionsPortalNode] = useState<HTMLDivElement | null>(null);
  const { me } = useMeMailbox();

  // Read the saved preference after mount (not in the initializer) so the
  // server-rendered and first client-rendered markup match — avoids a
  // hydration mismatch.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    if (!me?.hasStoredMailbox) return;
    if (isWorkspacePrefetchSessionComplete()) return;
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

  useEffect(() => {
    if (me?.role !== "admin") return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void prefetchAdminTeamData({ signal: ac.signal });
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [me?.role]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <aside
        className={cn(
          "workspace-sidebar fixed inset-y-0 left-0 z-40 hidden border-r transition-[width] duration-200 md:block",
          collapsed ? "w-[72px]" : "w-[220px]",
        )}
        aria-label="Main navigation"
      >
        <WorkspaceSidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      <ContentTopbar actionsNode={setActionsPortalNode} collapsed={collapsed} />

      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--color-border)] nucleus-backdrop px-4 pt-[env(safe-area-inset-top,0px)] md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] active:scale-90"
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
        <Link href="/inbox" prefetch className="flex-1">
          <PlacecomLogo />
        </Link>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
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
            <WorkspaceSidebar onCloseMobile={closeMobile} />
          </div>
        </div>
      )}

      <TopbarActionsPortalContext.Provider value={actionsPortalNode}>
        <ExtractionRunProvider>
          <ContactPhotoProvider>
            <main
              className={cn(
                "flex-1 min-w-0 min-h-screen overflow-hidden transition-[margin-left] duration-200",
                collapsed ? "md:ml-[72px]" : "md:ml-[220px]",
                "md:px-6 md:pb-6",
                "pt-[calc(56px+16px+env(safe-area-inset-top,0px))] px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] md:pt-[80px]",
              )}
            >
              {children}
            </main>
            <ExtractionRunBanner />
          </ContactPhotoProvider>
        </ExtractionRunProvider>
      </TopbarActionsPortalContext.Provider>
    </div>
  );
}
