"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconChevronDown } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from "@/lib/feature-access";

type TeamMember = {
  id: string;
  email: string | null;
  displayUsername: string | null;
  role: "staff" | "committee";
  restrictedFeatures: FeatureKey[];
  mobilePhone: string | null;
  exotelVirtualNumber: string | null;
  newPassword?: string;
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
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [exotelNumbers, setExotelNumbers] = useState<string[]>([]);
  const [newMobilePhone, setNewMobilePhone] = useState("");
  const [newExotelNumber, setNewExotelNumber] = useState("");

  function feedbackClass(text: string | null): string {
    if (!text) return "";
    const m = text.toLowerCase();
    if (
      m.includes("created") ||
      m.includes("member updated") ||
      m.includes("team member removed")
    ) {
      return "text-indigo-700 dark:text-indigo-400";
    }
    return "text-red-600 dark:text-red-400";
  }

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
    void (async () => {
      try {
        const res = await fetch("/api/admin/exotel-numbers");
        const j = (await res.json().catch(() => ({}))) as { numbers?: string[] };
        if (res.ok) setExotelNumbers(j.numbers ?? []);
      } catch {
        setExotelNumbers([]);
      }
    })();
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
      setNewMobilePhone("");
      setNewExotelNumber("");
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
          email: member.email?.trim().toLowerCase() ?? "",
          password: member.newPassword ?? "",
          role: member.role,
          restrictedFeatures: member.role === "committee" ? member.restrictedFeatures : [],
          mobilePhone: member.mobilePhone,
          exotelVirtualNumber: member.exotelVirtualNumber,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error || "Failed to update member permissions.");
        return;
      }
      setMsg("Member updated.");
      void loadMembers();
    } catch {
      setMsg("Network error");
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
    setMsg(null);
    setDeletingMemberId(member.id);
    try {
      const res = await fetch("/api/admin/team-members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error || "Could not remove team member.");
        return;
      }
      setMsg(titleCase("Team member removed."));
      void loadMembers();
    } catch {
      setMsg("Network error");
    } finally {
      setDeletingMemberId(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {titleCase("Team & shared mailbox")}
          </h1>
          <Link
            href="/admin/analytics"
            className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {titleCase("View analytics →")}
          </Link>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {titleCase(
            "Create staff accounts here. Each person gets their own login and automatically uses your connected Gmail. Assign each member an Exotel line and their personal mobile so inbound calls to that line transfer to them and outbound calls work from the app."
          )}
        </p>
        {msg ? (
          <p className={`mt-4 text-sm ${feedbackClass(msg)}`} role="status">
            {msg}
          </p>
        ) : null}
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
              {titleCase("Allow access to these features")}
            </p>
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              {titleCase("Checked means this committee member can use the feature. Uncheck to block it.")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_KEYS.map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={!restricted.includes(feature)}
                    onChange={() => toggleRestricted(feature)}
                  />
                  {titleCase(FEATURE_LABELS[feature])}
                </label>
              ))}
            </div>
          </div>
        ) : null}
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
          {titleCase("Assigned Exotel number")}
        </label>
        {exotelNumbers.length > 0 ? (
          <select
            value={newExotelNumber}
            onChange={(e) => setNewExotelNumber(e.target.value)}
            className="input-field w-full text-sm"
          >
            <option value="">{titleCase("Not assigned")}</option>
            {exotelNumbers.map((n) => (
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
            placeholder="+91… (set EXOTEL_VIRTUAL_NUMBERS on server)"
            className="input-field w-full text-sm"
          />
        )}
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {titleCase(
            "Inbound calls to this Exotel line ring their mobile. Outbound calls dial this Exotel number from the app.",
          )}
        </p>
        <button
          type="button"
          disabled={busy || !email.trim() || password.length < 8}
          onClick={() => void createStaff()}
          className="btn-primary mt-2 w-full"
        >
          {busy ? titleCase("Creating…") : titleCase("Create staff account")}
        </button>
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
                      {(member.email || "no-email")} • {titleCase(member.role)}
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
                    {exotelNumbers.length > 0 ? (
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
                        {exotelNumbers.map((n) => (
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

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Set new password (optional)")}
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={member.newPassword ?? ""}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((m) =>
                            m.id === member.id ? { ...m, newPassword: e.target.value } : m
                          )
                        )
                      }
                      className="input-field w-full text-sm"
                      placeholder="••••••••"
                    />
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {titleCase(
                        "Leave blank to keep their current password. If you enter one and save, it replaces the old password and only the new one will work.",
                      )}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Role")}
                    </label>
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
                      className="input-field w-full text-xs"
                    >
                      <option value="staff">Staff</option>
                      <option value="committee">Committee</option>
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {titleCase("Allow access to these features")}
                    </p>
                    <p className="mb-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                      {titleCase("Checked = can use. Uncheck = blocked for this member.")}
                    </p>
                    {member.role === "committee" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {FEATURE_KEYS.map((feature) => (
                          <label
                            key={feature}
                            className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                          >
                            <input
                              type="checkbox"
                              checked={!member.restrictedFeatures.includes(feature)}
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
                    ) : (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {titleCase("Full access")}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link
                      href={`/admin/analytics/${member.id}`}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-center text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {titleCase("View analytics →")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void saveMember(member)}
                      disabled={savingMemberId === member.id || deletingMemberId === member.id}
                      className="btn-secondary w-full"
                    >
                      {savingMemberId === member.id ? titleCase("Saving...") : titleCase("Save changes")}
                    </button>
                    <button
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
