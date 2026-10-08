"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { GROUP_MANAGEABLE_FEATURES, FEATURE_LABELS, type FeatureKey } from "@/lib/feature-access";
import { titleCase } from "@/lib/title-case";

export type TeamGroup = {
  id: string;
  name: string;
  restrictedFeatures: FeatureKey[];
};

type Props = {
  groups: TeamGroup[];
  groupsLoading?: boolean;
  /** Members per group id, for the cards. */
  memberCounts?: Record<string, number>;
  onRefresh?: () => void | Promise<void>;
  onToast?: (message: string, variant: "info" | "success" | "error") => void;
  allowedFeatures?: FeatureKey[];
};

/** Add dialog, or edit dialog for one group. */
type Dialog = { mode: "add" } | { mode: "edit"; group: TeamGroup };

/**
 * Only count features actually shown/toggleable in the checklist — a stray
 * entry outside GROUP_MANAGEABLE_FEATURES (e.g. a legacy value from before a
 * feature was removed from it) shouldn't show as "blocked" with no way to see
 * or change it.
 */
function blockedLabel(group: TeamGroup): string {
  const visibleBlocked = group.restrictedFeatures.filter((f) => GROUP_MANAGEABLE_FEATURES.includes(f));
  return visibleBlocked.length ? `${plural(visibleBlocked.length, "module")} blocked` : titleCase("Full access");
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

function FeatureChecklist({
  blockedFeatures,
  onToggle,
  allowedFeatures,
}: {
  blockedFeatures: FeatureKey[];
  onToggle: (feature: FeatureKey) => void;
  allowedFeatures?: FeatureKey[];
}) {
  const manageableFeatures = allowedFeatures
    ? GROUP_MANAGEABLE_FEATURES.filter((f) => allowedFeatures.includes(f))
    : GROUP_MANAGEABLE_FEATURES;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {manageableFeatures.map((feature) => (
        <label key={feature} className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={!blockedFeatures.includes(feature)}
            onChange={() => onToggle(feature)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-copper)]"
          />
          {titleCase(FEATURE_LABELS[feature])}
        </label>
      ))}
    </div>
  );
}

export function AdminGroupsPanel({ groups, groupsLoading = false, memberCounts, onRefresh, onToast, allowedFeatures }: Props) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [blocked, setBlocked] = useState<FeatureKey[]>([]);
  const [busy, setBusy] = useState(false);

  function notify(message: string, variant: "info" | "success" | "error" = "info") {
    onToast?.(message, variant);
  }

  function toggleBlocked(feature: FeatureKey) {
    setBlocked((list) => (list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]));
  }

  function openAdd() {
    setName("");
    setBlocked([]);
    setDialog({ mode: "add" });
  }

  function openEdit(group: TeamGroup) {
    setName(group.name);
    setBlocked([...group.restrictedFeatures]);
    setDialog({ mode: "edit", group });
  }

  function closeDialog() {
    if (!busy) setDialog(null);
  }

  async function submit() {
    if (!dialog || !name.trim()) return;
    const editing = dialog.mode === "edit";
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { groupId: dialog.group.id, name, restrictedFeatures: blocked }
            : { name, restrictedFeatures: blocked }
        ),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || (editing ? "Could not update group" : "Could not create group"));
      setDialog(null);
      notify(editing ? "Group updated." : "Group created.", "success");
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save group", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(group: TeamGroup) {
    if (!confirm(`Delete group "${group.name}"? Members will be unassigned from this group.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not delete group");
      setDialog(null);
      notify("Group deleted.", "success");
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not delete group", "error");
    } finally {
      setBusy(false);
    }
  }

  const editing = dialog?.mode === "edit" ? dialog.group : null;

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-[var(--color-text-muted)]">
          A group decides which modules its members can use. Members with no group have full access.
        </p>
        <button
          type="button"
          data-testid="team-add-group-btn"
          onClick={openAdd}
          className="btn-primary-copper inline-flex shrink-0 items-center gap-2 px-4"
        >
          <Plus className="h-4 w-4" />
          {titleCase("Add group")}
        </button>
      </div>

      {groupsLoading ? (
        <p className="text-[13px] text-[var(--color-text-faint)]">{titleCase("Loading groups…")}</p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-faint)]">
          {titleCase("No custom groups yet. Full access = leave group unassigned when adding members.")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`team-group-card-${g.id}`}
              onClick={() => openEdit(g)}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-surface-offset)]/60"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{g.name}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-muted)]">
                  {memberCounts ? `${plural(memberCounts[g.id] ?? 0, "member")} · ` : ""}
                  {blockedLabel(g)}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-[var(--color-copper)]">{titleCase("Edit")}</span>
            </button>
          ))}
        </div>
      )}

      {dialog &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form
              data-testid="team-group-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="team-group-title"
              className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void submit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeDialog();
              }}
            >
              <div className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
                <h2 id="team-group-title" className="font-display text-lg font-bold text-[var(--color-text)]">
                  {editing ? titleCase("Edit group") : titleCase("Add group")}
                </h2>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {titleCase("Group name")}
                </label>
                <input
                  data-testid="team-group-name-input"
                  autoFocus
                  className="input-field w-full text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Placement Team, Interns"
                />
                <p className="pt-1 text-[11px] text-[var(--color-text-faint)]">
                  {titleCase("Allowed features (unchecked = blocked)")}
                </p>
                <FeatureChecklist blockedFeatures={blocked} onToggle={toggleBlocked} allowedFeatures={allowedFeatures} />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-6 py-4">
                {editing ? (
                  <button
                    type="button"
                    data-testid="team-group-delete"
                    className="btn-danger px-3"
                    disabled={busy}
                    onClick={() => void deleteGroup(editing)}
                  >
                    {titleCase("Delete group")}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost px-4" disabled={busy} onClick={closeDialog}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="team-group-submit"
                    className="btn-primary-copper px-4"
                    disabled={busy || !name.trim()}
                  >
                    {busy
                      ? titleCase("Saving…")
                      : editing
                        ? titleCase("Save changes")
                        : titleCase("Create group")}
                  </button>
                </div>
              </div>
            </form>
          </div>,
          document.body
        )}
    </div>
  );
}

export function AdminGroupsPanelLoader(props: Props) {
  return <AdminGroupsPanel {...props} />;
}
