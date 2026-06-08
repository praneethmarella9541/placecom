"use client";

import { useCallback, useEffect, useState } from "react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconX } from "@/components/Icons";

/**
 * Gmail-style "Share" modal for a Drive file or folder.
 *
 * Layout matches Google Drive's:
 *   - Header: "Share {filename}"
 *   - "Add people" row: email/name input + role dropdown + Send button
 *   - List of current people with roles + a kebab to change/remove
 *   - "General access" row: Restricted vs. Anyone with the link, with role
 *   - Footer: Copy link + Done
 */

type Role = "reader" | "commenter" | "writer";
type PermissionType = "user" | "group" | "domain" | "anyone";

type Permission = {
  id: string;
  type: PermissionType;
  role: Role | "owner";
  emailAddress?: string;
  displayName?: string;
  photoLink?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
};

type Props = {
  fileId: string;
  fileName: string;
  isFolder: boolean;
  onClose: () => void;
};

const ROLE_LABEL: Record<Role, string> = {
  reader: "Viewer",
  commenter: "Commenter",
  writer: "Editor",
};

export function DriveShareModal({ fileId, fileName, isFolder, onClose }: Props) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-people form
  const [emailInput, setEmailInput] = useState("");
  const [pendingRole, setPendingRole] = useState<Role>("writer");
  const [pendingNote, setPendingNote] = useState("");
  const [adding, setAdding] = useState(false);

  // Action busy state per-permission for inline operations
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}/permissions`);
      const j = (await res.json()) as {
        permissions?: Permission[];
        shareLink?: string | null;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(j.message || j.error || "Failed to load sharing settings");
      setPermissions(j.permissions ?? []);
      setShareLink(j.shareLink ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sharing settings");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => { void load(); }, [load]);

  /** Add a user permission for the email(s) in the input. Splits on comma/space. */
  async function handleAddPeople() {
    const emails = emailInput
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (emails.length === 0) {
      setError("Enter at least one valid email address.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        emails.map((emailAddress) =>
          fetch(`/api/drive/file/${encodeURIComponent(fileId)}/permissions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: pendingRole,
              type: "user",
              emailAddress,
              sendNotificationEmail: true,
              emailMessage: pendingNote.trim() || undefined,
            }),
          }).then(async (r) => {
            const j = (await r.json()) as { permission?: Permission; error?: string; message?: string };
            if (!r.ok) throw new Error(j.message || j.error || "Add failed");
            return j.permission!;
          })
        )
      );
      const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      if (failures.length > 0) {
        // Dedupe identical reasons (e.g. all recipients hit the same
        // "you can't share this item" error) for a cleaner message.
        const reasons = Array.from(
          new Set(failures.map((f) => (f.reason as Error).message))
        );
        setError(reasons.join(" "));
      }
      setEmailInput("");
      setPendingNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to share");
    } finally {
      setAdding(false);
    }
  }

  /** Change an existing permission's role. */
  async function handleChangeRole(perm: Permission, nextRole: Role) {
    setBusyId(perm.id);
    try {
      const res = await fetch(
        `/api/drive/file/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(perm.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string };
        throw new Error(j.message || j.error || "Failed to update role");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(perm: Permission) {
    if (!window.confirm(`Remove ${perm.displayName || perm.emailAddress || "this person"}'s access?`)) return;
    setBusyId(perm.id);
    try {
      const res = await fetch(
        `/api/drive/file/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(perm.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string };
        throw new Error(j.message || j.error || "Failed to remove");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusyId(null);
    }
  }

  /** Toggle "anyone with the link" general access. */
  const anyonePermission = permissions.find((p) => p.type === "anyone");
  async function setLinkAccess(nextRole: Role | "off") {
    setBusyId("anyone");
    try {
      if (nextRole === "off") {
        if (!anyonePermission) return;
        const res = await fetch(
          `/api/drive/file/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(anyonePermission.id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string; message?: string };
          throw new Error(j.message || j.error || "Failed to disable link sharing");
        }
      } else if (anyonePermission) {
        // Change existing anyone permission's role
        if (anyonePermission.role === nextRole) { setBusyId(null); return; }
        const res = await fetch(
          `/api/drive/file/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(anyonePermission.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: nextRole }),
          }
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string; message?: string };
          throw new Error(j.message || j.error || "Failed to update link access");
        }
      } else {
        // Add a new "anyone" permission
        const res = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}/permissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole, type: "anyone" }),
        });
        if (!res.ok) {
          const j = (await res.json()) as { error?: string; message?: string };
          throw new Error(j.message || j.error || "Failed to enable link sharing");
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update link access");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Fallback — most browsers refuse clipboard from iframe / non-https
      window.prompt("Copy this link:", shareLink);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Share</h3>
            <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-muted)]">
              {fileName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Add people */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Add people by email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddPeople(); } }}
                className="input-field h-9 flex-1 text-[13px]"
              />
              <select
                value={pendingRole}
                onChange={(e) => setPendingRole(e.target.value as Role)}
                className="input-field h-9 w-28 text-[13px]"
              >
                <option value="writer">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="reader">Viewer</option>
              </select>
              <button
                type="button"
                onClick={() => void handleAddPeople()}
                disabled={adding || !emailInput.trim()}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {adding ? "Sharing…" : "Send"}
              </button>
            </div>
            <textarea
              rows={2}
              placeholder="Add a message (optional)"
              value={pendingNote}
              onChange={(e) => setPendingNote(e.target.value)}
              className="input-field mt-2 w-full resize-none text-[13px]"
            />
          </div>

          {error && (
            <p className="rounded-md bg-[var(--color-danger-light)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {error}
            </p>
          )}

          {/* People with access */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              People with access
            </p>
            {loading ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>
            ) : (
              <ul className="space-y-1.5">
                {permissions
                  .filter((p) => p.type === "user" || p.type === "group")
                  .map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-offset)]"
                    >
                      <GmailAvatar
                        seed={p.emailAddress || p.displayName || p.id}
                        name={p.displayName || p.emailAddress || "?"}
                        email={p.emailAddress}
                        photoUrl={p.photoLink}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--color-text)]">
                          {p.displayName || p.emailAddress}
                        </p>
                        {p.emailAddress && p.displayName && (
                          <p className="truncate text-[11px] text-[var(--color-text-muted)]">
                            {p.emailAddress}
                          </p>
                        )}
                      </div>
                      {p.role === "owner" ? (
                        <span className="text-[12px] text-[var(--color-text-muted)]">Owner</span>
                      ) : (
                        <>
                          <select
                            value={p.role}
                            disabled={busyId === p.id}
                            onChange={(e) => void handleChangeRole(p, e.target.value as Role)}
                            className="input-field h-7 w-28 text-[12px]"
                          >
                            <option value="writer">Editor</option>
                            <option value="commenter">Commenter</option>
                            <option value="reader">Viewer</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleRemove(p)}
                            disabled={busyId === p.id}
                            className="btn-ghost p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                            title="Remove access"
                            aria-label="Remove access"
                          >
                            <IconX className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                {permissions.filter((p) => p.type === "user" || p.type === "group").length === 0 && (
                  <li className="px-2 py-1.5 text-[12px] text-[var(--color-text-muted)]">
                    Only you have access.
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* General access */}
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              General access
            </p>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
                {/* link icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <select
                  value={anyonePermission ? "anyone" : "restricted"}
                  onChange={(e) => {
                    if (e.target.value === "restricted") void setLinkAccess("off");
                    else void setLinkAccess("reader");
                  }}
                  disabled={busyId === "anyone"}
                  className="input-field h-7 w-full max-w-[200px] text-[12px]"
                >
                  <option value="restricted">Restricted</option>
                  <option value="anyone">Anyone with the link</option>
                </select>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {anyonePermission
                    ? `Anyone on the internet with the link can ${ROLE_LABEL[anyonePermission.role as Role].toLowerCase()}`
                    : "Only people with access can open with the link"}
                </p>
              </div>
              {anyonePermission && (
                <select
                  value={anyonePermission.role}
                  disabled={busyId === "anyone"}
                  onChange={(e) => void setLinkAccess(e.target.value as Role)}
                  className="input-field h-7 w-28 text-[12px]"
                >
                  <option value="reader">Viewer</option>
                  <option value="commenter">Commenter</option>
                  <option value="writer">Editor</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            disabled={!shareLink}
            className="btn-ghost gap-2 text-[13px] disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {linkCopied ? "Copied!" : isFolder ? "Copy folder link" : "Copy link"}
          </button>
          <button type="button" onClick={onClose} className="btn-primary text-[13px]">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
