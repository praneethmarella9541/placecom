"use client";

import { useEffect, useState } from "react";
import { titleCase } from "@/lib/title-case";
import { FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from "@/lib/feature-access";

type TeamMember = {
  id: string;
  displayUsername: string | null;
  role: "staff" | "committee";
  restrictedFeatures: FeatureKey[];
};

export default function AdminTeamPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"staff" | "committee">("staff");
  const [restricted, setRestricted] = useState<FeatureKey[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);

  function toggleRestricted(feature: FeatureKey) {
    setRestricted((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  }

  async function loadMembers() {
    setLoadingMembers(true);
    try {
      const res = await fetch("/api/admin/team-members");
      const j = (await res.json().catch(() => ({}))) as { error?: string; members?: TeamMember[] };
      if (!res.ok) {
        setMsg(j.error || "Could not load team members.");
        return;
      }
      setMembers((j.members ?? []).filter((m) => m.role === "staff" || m.role === "committee"));
    } catch {
      setMsg("Could not load team members.");
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, []);

  async function createStaff() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/staff-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          role,
          restrictedFeatures: role === "committee" ? restricted : [],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        email?: string;
      };
      if (!res.ok) {
        setMsg(j.error || "Request failed");
        return;
      }
      setMsg(
        `${titleCase(role)} account created for ${j.email ?? email.trim()}. They can sign in on the home page with this email and password.`
      );
      setEmail("");
      setPassword("");
      setRole("staff");
      setRestricted([]);
      void loadMembers();
    } catch {
      setMsg("Network error");
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
          role: member.role,
          restrictedFeatures: member.role === "committee" ? member.restrictedFeatures : [],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error || "Failed to update member permissions.");
        return;
      }
      setMsg("Member permissions updated.");
      void loadMembers();
    } catch {
      setMsg("Network error");
    } finally {
      setSavingMemberId(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleCase("Team & shared mailbox")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {titleCase(
            "Create staff accounts here. Each person gets their own login and automatically uses your connected Gmail. Tell them the password you set, or have them change it later in Supabase if you prefer."
          )}
        </p>
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {titleCase("Add staff member")}
        </h2>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Work email")}
        </label>
        <input
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
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="input-field w-full text-sm"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Access type")}
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value === "committee" ? "committee" : "staff")}
          className="input-field w-full text-sm"
        >
          <option value="staff">Staff (full access)</option>
          <option value="committee">Committee (limited)</option>
        </select>
        {role === "committee" ? (
          <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {titleCase("Disable these features for this committee member")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_KEYS.map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={restricted.includes(feature)}
                    onChange={() => toggleRestricted(feature)}
                  />
                  {titleCase(FEATURE_LABELS[feature])}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          disabled={busy || !email.trim() || password.length < 8}
          onClick={() => void createStaff()}
          className="btn-primary mt-2 w-full"
        >
          {busy ? titleCase("Creating…") : titleCase("Create staff account")}
        </button>
        {msg ? (
          <p
            className={`text-sm ${msg.includes("created") ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {msg}
          </p>
        ) : null}
      </div>

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
              <div
                key={member.id}
                className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {member.displayUsername || member.id}
                  </p>
                  <select
                    value={member.role}
                    onChange={(e) => {
                      const nextRole = e.target.value === "committee" ? "committee" : "staff";
                      setMembers((prev) =>
                        prev.map((m) =>
                          m.id === member.id
                            ? {
                                ...m,
                                role: nextRole,
                                restrictedFeatures: nextRole === "committee" ? m.restrictedFeatures : [],
                              }
                            : m
                        )
                      );
                    }}
                    className="input-field w-44 text-xs"
                  >
                    <option value="staff">Staff</option>
                    <option value="committee">Committee</option>
                  </select>
                </div>
                {member.role === "committee" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {FEATURE_KEYS.map((feature) => (
                      <label
                        key={feature}
                        className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                      >
                        <input
                          type="checkbox"
                          checked={member.restrictedFeatures.includes(feature)}
                          onChange={() => {
                            setMembers((prev) =>
                              prev.map((m) => {
                                if (m.id !== member.id) return m;
                                const nextRestricted = m.restrictedFeatures.includes(feature)
                                  ? m.restrictedFeatures.filter((f) => f !== feature)
                                  : [...m.restrictedFeatures, feature];
                                return { ...m, restrictedFeatures: nextRestricted };
                              })
                            );
                          }}
                        />
                        {titleCase(FEATURE_LABELS[feature])}
                      </label>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void saveMember(member)}
                  disabled={savingMemberId === member.id}
                  className="btn-secondary mt-3 w-full"
                >
                  {savingMemberId === member.id ? titleCase("Saving...") : titleCase("Save access")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
