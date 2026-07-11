"use client";

import { createContext, useContext } from "react";

/**
 * Lets a module page (e.g. Mail) render its own search/primary-action controls
 * into the shared WorkspaceChrome topbar via a portal, instead of the topbar
 * having to know about every module's search semantics.
 *
 * Split into its own module (rather than living in WorkspaceChrome.tsx) so
 * pages that just need the hook don't pull WorkspaceChrome's whole provider
 * tree into their page-specific bundle.
 */
export const TopbarActionsPortalContext = createContext<HTMLDivElement | null>(null);

export function useWorkspaceTopbarActionsNode(): HTMLDivElement | null {
  return useContext(TopbarActionsPortalContext);
}
