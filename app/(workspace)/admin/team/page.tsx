"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { clearAnalyticsPrefetch, prefetchAnalytics } from "@/lib/analytics-prefetch";
import { rangeEndingToday } from "@/components/DateRangePicker";
import { BarChart3, Plus } from "lucide-react";
import { PasswordInput } from "@/components/PasswordInput";
import { GmailAvatar } from "@/components/GmailAvatar";
import { AdminGroupsPanel, type TeamGroup } from "@/components/AdminGroupsPanel";
import { AdminToast, toastVariantForMessage, type AdminToastState } from "@/components/AdminToast";
import {
  getAdminTeamPrefetchCache,
  prefetchAdminTeamData,
  clearAdminTeamPrefetchCache,
  type AdminTeamMember,
} from "@/lib/admin-team-prefetch";
import { GROUP_MANAGEABLE_FEATURES, getAllowedFeatures, type FeatureKey } from "@/lib/feature-access";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { titleCase } from "@/lib/title-case";
import { exotelNumbersForSelect, filterAvailableExotelNumbers } from "@/lib/admin-exotel-select";

type TeamMember = AdminTeamMember & { newPassword?: string };

/** Pill keys besides a group's own id. */
const ALL_PILL = "all";
const NO_GROUP_PILL = "none";

function groupIdsOf(members: AdminTeamMember[]): Record<string, string | null> {
  return Object.fromEntries(members.map((m) => [m.id, m.groupId]));
}

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
  const { me } = useMeMailbox();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newDisplayUsername, setNewDisplayUsername] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [groups, setGroups] = useState<TeamGroup[]>(boot.groups);
  const [toast, setToast] = useState<AdminToastState>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<"members" | "groups">("members");
  const [activePill, setActivePill] = useState(ALL_PILL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Height of the member list on "All" — the most it ever needs, held while a smaller pill is open. */
  const [allListHeight, setAllListHeight] = useState(0);
  // Which group each member is *saved* in. The member rows are edited in place
  // (the group select changes `members` immediately), so grouping by the live
  // value would pull a row out of its pill mid-edit, before Save.
  const [savedGroupIds, setSavedGroupIds] = useState<Record<string, string | null>>(() => groupIdsOf(boot.members));
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
    setSavedGroupIds(groupIdsOf(snap.members));
    setGroups(snap.groups);
    setConfiguredExotelNumbers(snap.configuredExotelNumbers);
    setAssignedExotelNumbers(snap.assignedExotelNumbers);
  }, []);

  const pills = useMemo(() => {
    const groupOf = (m: TeamMember) => (m.id in savedGroupIds ? savedGroupIds[m.id] : m.groupId);
    const knownGroupIds = new Set(groups.map((g) => g.id));
    const count = (pred: (g: string | null) => boolean) => members.filter((m) => pred(groupOf(m))).length;
    const list = [
      { key: ALL_PILL, label: "All", count: members.length, match: () => true },
      ...groups
        .map((g) => ({ key: g.id, label: g.name, count: count((id) => id === g.id), match: (id: string | null) => id === g.id }))
        .filter((p) => p.count > 0),
      {
        key: NO_GROUP_PILL,
        label: "Full access",
        count: count((id) => !id || !knownGroupIds.has(id)),
        match: (id: string | null) => !id || !knownGroupIds.has(id),
      },
    ].filter((p) => p.key === ALL_PILL || p.count > 0);
    return list.map((p) => ({ ...p, members: members.filter((m) => p.match(groupOf(m))) }));
  }, [members, groups, savedGroupIds]);

  // The pill someone was on can vanish (its last member moved or was removed).
  const activeKey = pills.some((p) => p.key === activePill) ? activePill : ALL_PILL;
  const visibleMembers = pills.find((p) => p.key === activeKey)?.members ?? members;

  function prefetchDefaultAnalytics() {
    const r = rangeEndingToday(14);
    prefetchAnalytics(`?from=${r.from}&to=${r.to}`);
  }

  const memberCountsByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of members) {
      const id = m.id in savedGroupIds ? savedGroupIds[m.id] : m.groupId;
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [members, savedGroupIds]);

  const editingMember = editingId ? (members.find((m) => m.id === editingId) ?? null) : null;
  const memberBusy = savingMemberId !== null || deletingMemberId !== null;

  /** Closing without saving drops the in-place edits by restoring the last saved snapshot. */
  function closeEdit() {
    setEditingId(null);
    const cached = getAdminTeamPrefetchCache();
    if (cached) applySnapshot(cached);
    else void revalidate({ silent: true });
  }

  // A group with fewer members would make the list, and so the page, shorter
  // and pull everything below it up. Remember how tall "All" is and hold that
  // height while a pill is open. Measured only on "All" (where nothing is held),
  // and kept current as members come and go or the window resizes.
  useEffect(() => {
    const el = listRef.current;
    if (!el || activeKey !== ALL_PILL) return;
    const measure = () => setAllListHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeKey, members.length, loadingMembers, tab]);

  const availableExotelNumbers = useMemo(
    () => filterAvailableExotelNumbers(configuredExotelNumbers, assignedExotelNumbers),
    [configuredExotelNumbers, assignedExotelNumbers],
  );

  /**
   * The deployment's own feature cap. Beyond narrowing the group checklist this
   * also doubles as "is this a subdomain portal?", which is why the OpenAI,
   * mobile, and Exotel fields below key off it — keep it env-only.
   */
  const allowedFeatures = useMemo<FeatureKey[] | undefined>(() => {
    const val = process.env.NEXT_PUBLIC_ALLOWED_FEATURES;
    if (!val?.trim()) return undefined;
    return val
      .split(",")
      .map((s) => s.trim())
      .filter((s) => GROUP_MANAGEABLE_FEATURES.includes(s as FeatureKey)) as FeatureKey[];
  }, []);

  /**
   * What an admin may actually hand out: the manageable set minus the
   * deployment cap minus anything switched off platform-wide in /configs.
   * Without the last term the checklist would offer modules that /configs has
   * removed, and granting one would appear to work while middleware kept
   * blocking it.
   */
  const manageableFeatures = useMemo<FeatureKey[]>(() => {
    const envAllowed = getAllowedFeatures();
    const platformDisabled = new Set(me?.disabledModules ?? []);
    return GROUP_MANAGEABLE_FEATURES.filter(
      (f) => !platformDisabled.has(f) && (!envAllowed || envAllowed.has(f))
    );
  }, [me?.disabledModules]);

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
      setAddOpen(false);
      clearAnalyticsPrefetch();
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
      setEditingId(null);
      clearAnalyticsPrefetch();
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
      setEditingId(null);
      clearAnalyticsPrefetch();
      void revalidate({ silent: true });
    } catch {
      showToast("Network error", "error");
    } finally {
      setDeletingMemberId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Team & shared mailbox")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            Add teammates and choose which parts of the workspace each access group can use.
          </p>
        </div>
        <Link
          href="/admin/analytics"
          data-testid="team-view-analytics"
          // Start loading the analytics page's default range (last 14 days) before the click.
          onMouseEnter={prefetchDefaultAnalytics}
          onFocus={prefetchDefaultAnalytics}
          className="btn-secondary shrink-0 px-4"
        >
          <BarChart3 className="h-4 w-4" aria-hidden />
          {titleCase("View analytics")}
        </Link>
      </header>

      <div
        role="tablist"
        aria-label="Team sections"
        className="flex max-w-md gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1"
      >
        {(
          [
            ["members", "Members", members.length],
            ["groups", "Access groups", groups.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`team-tab-${key}`}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
              tab === key
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {titleCase(label)}
            {!loadingMembers && <span className="ml-1.5 font-medium text-[var(--color-text-faint)]">({count})</span>}
          </button>
        ))}
      </div>

      {tab === "members" ? (
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-text-muted)]">
            Everyone who can sign in to this workspace. Pick a member to edit their details or access group.
          </p>
          <button
            type="button"
            data-testid="team-add-staff-btn"
            onClick={() => setAddOpen(true)}
            className="btn-primary-copper inline-flex shrink-0 items-center gap-2 px-4"
          >
            <Plus className="h-4 w-4" />
            {titleCase("Add staff member")}
          </button>
        </div>
        {loadingMembers ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{titleCase("Loading team members...")}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{titleCase("No members added yet.")}</p>
        ) : (
          <div className="space-y-4">
            {pills.length > 2 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter members by group">
                {pills.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="tab"
                    aria-selected={p.key === activeKey}
                    data-testid={`team-pill-${p.key}`}
                    onClick={() => setActivePill(p.key)}
                    className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                      p.key === activeKey
                        ? "border-[var(--color-copper)] bg-[var(--color-copper)] text-white"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                    }`}
                  >
                    {p.label} <span className="opacity-70">({p.count})</span>
                  </button>
                ))}
              </div>
            )}
            <div
              ref={listRef}
              className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3"
              style={{ minHeight: activeKey !== ALL_PILL && allListHeight ? allListHeight : undefined }}
            >
              {visibleMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  data-testid={`team-member-card-${member.id}`}
                  onClick={() => setEditingId(member.id)}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-surface-offset)]/60"
                >
                  <div className="flex items-center gap-3">
                    <GmailAvatar
                      seed={member.email || member.id}
                      email={member.email ?? undefined}
                      name={member.displayUsername || member.email || "?"}
                      size={40}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                        {member.displayUsername || member.email || member.id}
                      </p>
                      <p className="truncate text-xs text-[var(--color-text-muted)]">{member.email || "no-email"}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs text-[var(--color-text-muted)]">
                      <p className="truncate">{member.jobTitle || titleCase("No job title")}</p>
                      <p className="truncate">
                        {member.groupName || titleCase("Full access")}
                        {member.openaiTokenLimit != null
                          ? ` • ${member.tokensUsed.toLocaleString()}/${member.openaiTokenLimit.toLocaleString()} tokens`
                          : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--color-copper)]">{titleCase("Edit")}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      ) : (
      <AdminGroupsPanel
        groups={groups}
        groupsLoading={loadingMembers}
        memberCounts={memberCountsByGroup}
        onRefresh={() => revalidate({ silent: true })}
        onToast={showToast}
        allowedFeatures={manageableFeatures}
      />
      )}

      {editingMember &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form
              data-testid="team-edit-member-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="team-edit-member-title"
              className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
              onSubmit={(e) => {
                e.preventDefault();
                void saveMember(editingMember);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !memberBusy) closeEdit();
              }}
            >
              <div className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
                <h2 id="team-edit-member-title" className="font-display text-lg font-bold text-[var(--color-text)]">
                  {titleCase("Edit member")}
                </h2>
                <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-muted)]">
                  {editingMember.email ?? editingMember.id}
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Email")}
                    </label>
                    <input
                      type="email"
                      value={editingMember.email ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) => (m.id === editingMember.id ? { ...m, email: e.target.value } : m))
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
                      value={editingMember.displayUsername ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === editingMember.id ? { ...m, displayUsername: e.target.value || null } : m
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
                      value={editingMember.jobTitle ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === editingMember.id ? { ...m, jobTitle: e.target.value || null } : m
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
                      value={editingMember.groupId ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === editingMember.id
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
                          value={editingMember.mobilePhone ?? ""}
                          onChange={(e) =>
                            setMembers((prev) =>
                              prev.map((m) =>
                                m.id === editingMember.id ? { ...m, mobilePhone: e.target.value || null } : m
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
                        editingMember.exotelVirtualNumber?.trim() ? (
                          <select
                            value={editingMember.exotelVirtualNumber ?? ""}
                            onChange={(e) =>
                              setMembers((prev) =>
                                prev.map((m) =>
                                  m.id === editingMember.id
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
                                editingMember.exotelVirtualNumber,
                              ),
                              editingMember.exotelVirtualNumber,
                            ).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="tel"
                            value={editingMember.exotelVirtualNumber ?? ""}
                            onChange={(e) =>
                              setMembers((prev) =>
                                prev.map((m) =>
                                  m.id === editingMember.id
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
                      value={editingMember.newPassword ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === editingMember.id ? { ...m, newPassword: e.target.value } : m
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

                <Link href={`/admin/analytics/${editingMember.id}`} className="btn-secondary w-full">
                  <BarChart3 className="h-4 w-4" aria-hidden />
                  {titleCase("View member analytics")}
                </Link>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-6 py-4">
                <button
                  data-testid={`team-delete-member-${editingMember.id}`}
                  type="button"
                  onClick={() => void deleteMember(editingMember)}
                  disabled={memberBusy}
                  className="btn-danger px-3"
                >
                  {deletingMemberId === editingMember.id ? titleCase("Removing…") : titleCase("Remove from team")}
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost px-4" disabled={memberBusy} onClick={closeEdit}>
                    Cancel
                  </button>
                  <button
                    data-testid={`team-save-member-${editingMember.id}`}
                    type="submit"
                    disabled={memberBusy}
                    className="btn-primary-copper px-4"
                  >
                    {savingMemberId === editingMember.id ? titleCase("Saving...") : titleCase("Save changes")}
                  </button>
                </div>
              </div>
            </form>
          </div>,
          document.body
        )}
      {addOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form
              data-testid="team-add-staff-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="team-add-staff-title"
              className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && email.trim() && password.length >= 8) void createStaff();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !busy) setAddOpen(false);
              }}
            >
              <div className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
                <h2 id="team-add-staff-title" className="font-display text-lg font-bold text-[var(--color-text)]">
                  {titleCase("Add staff member")}
                </h2>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
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
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
                <button type="button" className="btn-ghost px-4" disabled={busy} onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button
                  data-testid="team-create-staff-btn"
                  type="submit"
                  disabled={busy || !email.trim() || password.length < 8}
                  className="btn-primary-copper px-4"
                >
                  {busy ? titleCase("Creating…") : titleCase("Create staff account")}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
    </div>
  );
}
