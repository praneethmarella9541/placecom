"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconChevronDown } from "@/components/Icons";
import { PasswordInput } from "@/components/PasswordInput";
import { AdminGroupsPanel, type TeamGroup } from "@/components/AdminGroupsPanel";
import { AdminToast, toastVariantForMessage, type AdminToastState } from "@/components/AdminToast";
import {
  getAdminTeamPrefetchCache,
  prefetchAdminTeamData,
  clearAdminTeamPrefetchCache,
  type AdminTeamMember,
} from "@/lib/admin-team-prefetch";
import { GROUP_MANAGEABLE_FEATURES, type FeatureKey } from "@/lib/feature-access";
import { titleCase } from "@/lib/title-case";
import { exotelNumbersForSelect, filterAvailableExotelNumbers } from "@/lib/admin-exotel-select";

type TeamMember = AdminTeamMember & { newPassword?: string };

function initialFromCache() {
  const cached = getAdminTeamPrefetchCache();
  return {
    members: cached?.members ?? [],
    groups: cached?.groups ?? [],
    configuredExotelNumbers: cached?.configuredExotelNumbers ?? cached?.exotelNumbers ?? [],
    assignedExotelNumbers: cached?.assignedExotelNumbers ?? [],
    hasCache: Boolean(cached),
  };
}

export default function AdminTeamPage() {
  const boot = initialFromCache();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newDisplayUsername, setNewDisplayUsername] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [groups, setGroups] = useState<TeamGroup[]>(boot.groups);
  const [toast, setToast] = useState<AdminToastState>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>(boot.members);
  const [loadingMembers, setLoadingMembers] = useState(!boot.hasCache);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [configuredExotelNumbers, setConfiguredExotelNumbers] = useState<string[]>(boot.configuredExotelNumbers);
  const [assignedExotelNumbers, setAssignedExotelNumbers] = useState<string[]>(boot.assignedExotelNumbers);
  const [newMobilePhone, setNewMobilePhone] = useState("");
  const [newExotelNumber, setNewExotelNumber] = useState("");

  const showToast = useCallback((message: string, variant?: "info" | "success" | "error") => {
    setToast({ message, variant: variant ?? toastVariantForMessage(message) });
  }, []);

  const applySnapshot = useCallback((snap: NonNullable<ReturnType<typeof getAdminTeamPrefetchCache>>) => {
    setMembers(snap.members);
    setGroups(snap.groups);
    setConfiguredExotelNumbers(snap.configuredExotelNumbers);
    setAssignedExotelNumbers(snap.assignedExotelNumbers);
  }, []);

  const availableExotelNumbers = useMemo(
    () => filterAvailableExotelNumbers(configuredExotelNumbers, assignedExotelNumbers),
    [configuredExotelNumbers, assignedExotelNumbers],
  );

  const allowedFeatures = useMemo<FeatureKey[] | undefined>(() => {
    const val = process.env.NEXT_PUBLIC_ALLOWED_FEATURES;
    if (!val?.trim()) return undefined;
    return val
      .split(",")
      .map((s) => s.trim())
      .filter((s) => GROUP_MANAGEABLE_FEATURES.includes(s as FeatureKey)) as FeatureKey[];
  }, []);

  const revalidate = useCallback(
    async (opts?: { silent?: boolean }) => {
      const hasCache = Boolean(getAdminTeamPrefetchCache());
      if (!opts?.silent && !hasCache) setLoadingMembers(true);
      try {
        const snap = await prefetchAdminTeamData({ force: true });
        if (snap) applySnapshot(snap);
      } catch {
        if (!hasCache) showToast("Could not load team members.", "error");
      } finally {
        setLoadingMembers(false);
      }
    },
    [applySnapshot, showToast],
  );

  useEffect(() => {
    const cached = getAdminTeamPrefetchCache();
    if (cached && !Array.isArray(cached.assignedExotelNumbers)) {
      clearAdminTeamPrefetchCache();
    } else if (cached) {
      applySnapshot(cached);
    }
    void revalidate({ silent: Boolean(cached) });
  }, [applySnapshot, revalidate]);

  async function createStaff() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/staff-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          groupId: newGroupId || null,
          displayUsername: newDisplayUsername.trim() || undefined,
          jobTitle: newJobTitle.trim() || null,
          mobilePhone: newMobilePhone.trim() || null,
          exotelVirtualNumber: newExotelNumber.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        email?: string;
      };
      if (!res.ok) {
        showToast(j.error || "Request failed", "error");
        return;
      }
      showToast(
        `Account created for ${j.email ?? email.trim()}. They can sign in on the home page with this email and password.`,
        "success",
      );
      setEmail("");
      setPassword("");
      setNewDisplayUsername("");
      setNewJobTitle("");
      setNewGroupId("");
      setNewMobilePhone("");
      setNewExotelNumber("");
      void revalidate({ silent: true });
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveMember(member: TeamMember) {
    setSavingMemberId(member.id);
    try {
      const res = await fetch("/api/admin/team-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.id,
          email: member.email?.trim().toLowerCase() ?? "",
          password: member.newPassword ?? "",
          displayUsername: member.displayUsername,
          jobTitle: member.jobTitle,
          bio: member.bio,
          groupId: member.groupId,
          openaiTokenLimit: member.openaiTokenLimit,
          mobilePhone: member.mobilePhone,
          exotelVirtualNumber: member.exotelVirtualNumber,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error || "Failed to update member permissions.", "error");
        return;
      }
      showToast("Member updated.", "success");
      void revalidate({ silent: true });
    } catch {
      showToast("Network error", "error");
    } finally {
      setSavingMemberId(null);
    }
  }

  async function deleteMember(member: TeamMember) {
    const label = member.email ?? member.displayUsername ?? member.id;
    if (
      !confirm(
        `Remove ${label} from your team? Their account will be deleted permanently and they will lose access.`,
      )
    ) {
      return;
    }
    setDeletingMemberId(member.id);
    try {
      const res = await fetch("/api/admin/team-members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error || "Could not remove team member.", "error");
        return;
      }
      showToast(titleCase("Team member removed."), "success");
      void revalidate({ silent: true });
    } catch {
      showToast("Network error", "error");
    } finally {
      setDeletingMemberId(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
      <AdminGroupsPanel
        groups={groups}
        groupsLoading={loadingMembers}
        onRefresh={() => revalidate({ silent: true })}
        onToast={showToast}
        allowedFeatures={allowedFeatures}
      />

      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Team & shared mailbox")}
          </h1>
          <Link
            href="/admin/analytics"
            className="shrink-0 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-surface-offset)]"
          >
            {titleCase("View analytics →")}
          </Link>
        </div>
      </div>

      <details className="team-member-details rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] group p-0">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
            {titleCase("Add staff member")}
          </h2>
          <IconChevronDown className="team-member-chevron h-4 w-4 shrink-0 text-[var(--color-text-faint)]" aria-hidden />
        </summary>
        <div className="space-y-3 border-t border-zinc-100 px-5 pb-5 pt-4 dark:border-zinc-800">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Work email")}
        </label>
        <input
          data-testid="team-new-email-input"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          className="input-field w-full text-sm"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Initial password (min. 8 characters)")}
        </label>
        <PasswordInput
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Display name")}
        </label>
        <input
          data-testid="team-new-display-name-input"
          value={newDisplayUsername}
          onChange={(e) => setNewDisplayUsername(e.target.value)}
          placeholder="Optional — defaults from email"
          className="input-field w-full text-sm"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Job title")}
        </label>
        <input
          value={newJobTitle}
          onChange={(e) => setNewJobTitle(e.target.value)}
          placeholder="Optional"
          className="input-field w-full text-sm"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Access group")}
        </label>
        <select
          data-testid="team-new-group-select"
          value={newGroupId}
          onChange={(e) => setNewGroupId(e.target.value)}
          className="input-field w-full text-sm"
        >
          <option value="">{titleCase("Full access (no group)")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {!allowedFeatures && (
          <>
            <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {titleCase("Personal mobile (for incoming call transfer)")}
            </label>
            <input
              type="tel"
              value={newMobilePhone}
              onChange={(e) => setNewMobilePhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="input-field w-full text-sm"
            />
            <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {titleCase("Assigned virtual number")}
            </label>
            {availableExotelNumbers.length > 0 ? (
              <select
                value={newExotelNumber}
                onChange={(e) => setNewExotelNumber(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="">{titleCase("Not assigned")}</option>
                {availableExotelNumbers.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="tel"
                value={newExotelNumber}
                onChange={(e) => setNewExotelNumber(e.target.value)}
                placeholder="+91… (loads from your Exotel account)"
                className="input-field w-full text-sm"
              />
            )}
          </>
        )}
        <button
          data-testid="team-create-staff-btn"
          type="button"
          disabled={busy || !email.trim() || password.length < 8}
          onClick={() => void createStaff()}
          className="btn-primary mt-2 w-full"
        >
          {busy ? titleCase("Creating…") : titleCase("Create staff account")}
        </button>
        </div>
      </details>

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {titleCase("Existing members")}
        </h2>
        {loadingMembers ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{titleCase("Loading team members...")}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{titleCase("No members added yet.")}</p>
        ) : (
          <div className="space-y-4">
            {members.map((member) => (
              <details
                key={member.id}
                className="team-member-details rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {member.displayUsername || member.email || member.id}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {(member.email || "no-email")} • {member.groupName || titleCase("Full access")}
                      {member.openaiTokenLimit != null
                        ? ` • ${member.tokensUsed.toLocaleString()}/${member.openaiTokenLimit.toLocaleString()} tokens`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{titleCase("Edit")}</span>
                    <IconChevronDown className="team-member-chevron h-4 w-4 text-zinc-400" aria-hidden />
                  </div>
                </summary>

                <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Email")}
                    </label>
                    <input
                      type="email"
                      value={member.email ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) => (m.id === member.id ? { ...m, email: e.target.value } : m))
                        )
                      }
                      className="input-field w-full text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Display name")}
                    </label>
                    <input
                      value={member.displayUsername ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === member.id ? { ...m, displayUsername: e.target.value || null } : m
                          )
                        )
                      }
                      className="input-field w-full text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Job title")}
                    </label>
                    <input
                      value={member.jobTitle ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === member.id ? { ...m, jobTitle: e.target.value || null } : m
                          )
                        )
                      }
                      className="input-field w-full text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Access group")}
                    </label>
                    <select
                      value={member.groupId ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === member.id
                              ? {
                                  ...m,
                                  groupId: e.target.value || null,
                                  groupName: groups.find((g) => g.id === e.target.value)?.name ?? null,
                                }
                              : m
                          )
                        )
                      }
                      className="input-field w-full text-sm"
                    >
                      <option value="">{titleCase("Full access (no group)")}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!allowedFeatures && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          {titleCase("Personal mobile")}
                        </label>
                        <input
                          type="tel"
                          value={member.mobilePhone ?? ""}
                          onChange={(e) =>
                            setMembers((prev) =>
                              prev.map((m) =>
                                m.id === member.id ? { ...m, mobilePhone: e.target.value || null } : m
                              )
                            )
                          }
                          placeholder="+91 98765 43210"
                          className="input-field w-full text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          {titleCase("Exotel number")}
                        </label>
                        {availableExotelNumbers.length > 0 ||
                        member.exotelVirtualNumber?.trim() ? (
                          <select
                            value={member.exotelVirtualNumber ?? ""}
                            onChange={(e) =>
                              setMembers((prev) =>
                                prev.map((m) =>
                                  m.id === member.id
                                    ? { ...m, exotelVirtualNumber: e.target.value || null }
                                    : m
                                )
                              )
                            }
                            className="input-field w-full text-sm"
                          >
                            <option value="">{titleCase("Not assigned")}</option>
                            {exotelNumbersForSelect(
                              filterAvailableExotelNumbers(
                                configuredExotelNumbers,
                                assignedExotelNumbers,
                                member.exotelVirtualNumber,
                              ),
                              member.exotelVirtualNumber,
                            ).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="tel"
                            value={member.exotelVirtualNumber ?? ""}
                            onChange={(e) =>
                              setMembers((prev) =>
                                prev.map((m) =>
                                  m.id === member.id
                                    ? { ...m, exotelVirtualNumber: e.target.value || null }
                                    : m
                                )
                              )
                            }
                            className="input-field w-full text-sm"
                          />
                        )}
                      </div>
                    </>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Set new password (optional)")}
                    </label>
                    <PasswordInput
                      autoComplete="new-password"
                      value={member.newPassword ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === member.id ? { ...m, newPassword: e.target.value } : m
                          )
                        )
                      }
                      placeholder="••••••••"
                    />
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {titleCase(
                        "Leave blank to keep their current password. If you enter one and save, it replaces the old password and only the new one will work.",
                      )}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link
                      href={`/admin/analytics/${member.id}`}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-center text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {titleCase("View analytics →")}
                    </Link>
                    <button
                      data-testid={`team-save-member-${member.id}`}
                      type="button"
                      onClick={() => void saveMember(member)}
                      disabled={savingMemberId === member.id || deletingMemberId === member.id}
                      className="btn-secondary w-full"
                    >
                      {savingMemberId === member.id ? titleCase("Saving...") : titleCase("Save changes")}
                    </button>
                    <button
                      data-testid={`team-delete-member-${member.id}`}
                      type="button"
                      onClick={() => void deleteMember(member)}
                      disabled={deletingMemberId === member.id || savingMemberId === member.id}
                      className="btn-danger w-full"
                    >
                      {deletingMemberId === member.id ? titleCase("Removing…") : titleCase("Remove from team")}
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
