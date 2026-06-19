"use client";

import { useState } from "react";
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
  onRefresh?: () => void | Promise<void>;
  onToast?: (message: string, variant: "info" | "success" | "error") => void;
  allowedFeatures?: FeatureKey[];
};

export function AdminGroupsPanel({ groups, groupsLoading = false, onRefresh, onToast, allowedFeatures }: Props) {
  const [name, setName] = useState("");
  const [blocked, setBlocked] = useState<FeatureKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBlocked, setEditBlocked] = useState<FeatureKey[]>([]);

  function notify(message: string, variant: "info" | "success" | "error" = "info") {
    onToast?.(message, variant);
  }

  function toggleBlocked(list: FeatureKey[], feature: FeatureKey, setter: (v: FeatureKey[]) => void) {
    setter(list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]);
  }

  async function createGroup() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, restrictedFeatures: blocked }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not create group");
      setName("");
      setBlocked([]);
      notify("Group created.", "success");
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not create group", "error");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(group: TeamGroup) {
    setEditingId(group.id);
    setEditName(group.name);
    setEditBlocked([...group.restrictedFeatures]);
  }

  async function saveEdit(groupId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, name: editName, restrictedFeatures: editBlocked }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not update group");
      setEditingId(null);
      notify("Group updated.", "success");
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update group", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(groupId: string, groupName: string) {
    if (!confirm(`Delete group "${groupName}"? Members will be unassigned from this group.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not delete group");
      notify("Group deleted.", "success");
      await onRefresh?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not delete group", "error");
    } finally {
      setBusy(false);
    }
  }

  function FeatureChecklist({
    blockedFeatures,
    onToggle,
  }: {
    blockedFeatures: FeatureKey[];
    onToggle: (feature: FeatureKey) => void;
  }) {
    const manageableFeatures = allowedFeatures
      ? GROUP_MANAGEABLE_FEATURES.filter((f) => allowedFeatures.includes(f))
      : GROUP_MANAGEABLE_FEATURES;
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {manageableFeatures.map((feature) => (
          <label key={feature} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={!blockedFeatures.includes(feature)}
              onChange={() => onToggle(feature)}
            />
            {titleCase(FEATURE_LABELS[feature])}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titleCase("Access groups")}</h2>
      </div>

      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">{titleCase("New group name")}</label>
        <input
          className="input-field w-full text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Placement Team, Interns"
        />
        <p className="text-[11px] text-zinc-500">{titleCase("Allowed features (unchecked = blocked)")}</p>
        <FeatureChecklist
          blockedFeatures={blocked}
          onToggle={(f) => toggleBlocked(blocked, f, setBlocked)}
        />
        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy || !name.trim()}
          onClick={() => void createGroup()}
        >
          {titleCase("Create group")}
        </button>
      </div>

      {groupsLoading ? (
        <p className="text-sm text-zinc-500">{titleCase("Loading groups…")}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-zinc-500">{titleCase("No custom groups yet. Full access = leave group unassigned when adding members.")}</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              {editingId === g.id ? (
                <div className="space-y-2">
                  <input className="input-field w-full text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <FeatureChecklist
                    blockedFeatures={editBlocked}
                    onToggle={(f) => toggleBlocked(editBlocked, f, setEditBlocked)}
                  />
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void saveEdit(g.id)}>
                      {titleCase("Save")}
                    </button>
                    <button type="button" className="btn-ghost flex-1" onClick={() => setEditingId(null)}>
                      {titleCase("Cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{g.name}</p>
                    <p className="text-xs text-zinc-500">
                      {g.restrictedFeatures.length
                        ? `${g.restrictedFeatures.length} feature(s) blocked`
                        : titleCase("Full access")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => startEdit(g)}>
                      {titleCase("Edit")}
                    </button>
                    <button type="button" className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => void deleteGroup(g.id, g.name)}>
                      {titleCase("Delete")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminGroupsPanelLoader(props: Props) {
  return <AdminGroupsPanel {...props} />;
}
