"use client";

import { useEffect, useState } from "react";
import type { MeProfileResponse } from "@/app/api/me/profile/route";
import { PasswordInput } from "@/components/PasswordInput";
import { titleCase } from "@/lib/title-case";
import { formatPhone } from "@/lib/wa-contacts-display";

export function ProfileSettings() {
  const [profile, setProfile] = useState<MeProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [displayUsername, setDisplayUsername] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [bio, setBio] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await fetch("/api/me/profile");
      const data = (await res.json()) as MeProfileResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load profile");
      setProfile(data);
      setDisplayUsername(data.displayUsername ?? "");
      setJobTitle(data.jobTitle ?? "");
      setBio(data.bio ?? "");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayUsername,
          jobTitle: jobTitle || null,
          bio: bio || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save profile");
      setMsg("Profile updated.");
      await loadProfile();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMsg("New passwords do not match.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not change password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg("Password updated.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading profile…")}</p>;
  }

  if (!profile) {
    return <p className="text-sm text-[var(--color-danger)]">{msg || titleCase("Could not load profile.")}</p>;
  }

  const tokenPct =
    profile.tokenLimit && profile.tokenLimit > 0
      ? Math.min(100, Math.round((profile.tokensUsed / profile.tokenLimit) * 100))
      : null;

  return (
    <div className="space-y-6">
      {msg && (
        <p
          className={`text-sm ${msg.toLowerCase().includes("updated") ? "text-indigo-700 dark:text-indigo-400" : "text-red-600 dark:text-red-400"}`}
          role="status"
        >
          {msg}
        </p>
      )}

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("Account access")}</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)]">{titleCase("Sign-in email")}</dt>
            <dd className="mt-0.5 text-[var(--color-text)]">{profile.sessionEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)]">{titleCase("Shared mailbox")}</dt>
            <dd className="mt-0.5 text-[var(--color-text)]">{profile.mailboxEmail || titleCase("Not linked yet")}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)]">{titleCase("Assigned virtual number")}</dt>
            <dd className="mt-0.5 text-[var(--color-text)]">
              {profile.exotelVirtualNumber
                ? formatPhone(profile.exotelVirtualNumber)
                : titleCase("Not assigned")}
            </dd>
          </div>
        </dl>
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("Your profile")}</h2>
        <form className="space-y-3" onSubmit={(e) => void saveProfile(e)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              {titleCase("Display name")}
            </label>
            <input
              data-testid="profile-display-name-input"
              className="input-field w-full text-sm"
              value={displayUsername}
              onChange={(e) => setDisplayUsername(e.target.value)}
              placeholder="How your name appears in the app"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              {titleCase("Job title")}
            </label>
            <input
              data-testid="profile-job-title-input"
              className="input-field w-full text-sm"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Placement Coordinator"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              {titleCase("Bio")}
            </label>
            <textarea
              data-testid="profile-bio-input"
              className="input-field min-h-[80px] w-full text-sm"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short note about your role"
            />
          </div>
          {profile.groupName && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {titleCase("Access group")}: <span className="font-medium">{profile.groupName}</span>
            </p>
          )}
          <button data-testid="profile-save-btn" type="submit" className="btn-primary" disabled={busy}>
            {busy ? titleCase("Saving…") : titleCase("Save profile")}
          </button>
        </form>
      </div>

      {profile.tokenLimit != null && (
        <div className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("OpenAI token allowance")}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {profile.tokensUsed.toLocaleString()} used
            {profile.tokenLimit > 0 ? ` of ${profile.tokenLimit.toLocaleString()} limit` : ""}
          </p>
          {tokenPct != null && (
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
              <div
                className={`h-full rounded-full ${tokenPct >= 100 ? "bg-[var(--color-danger)]" : "bg-[var(--color-primary)]"}`}
                style={{ width: `${tokenPct}%` }}
              />
            </div>
          )}
          {profile.tokensRemaining != null && profile.tokensRemaining <= 0 && (
            <p className="text-xs text-[var(--color-danger)]">
              {titleCase("Token limit reached. Contact your admin for more allowance.")}
            </p>
          )}
        </div>
      )}

      {profile.canChangePassword ? (
        <div className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("Change password")}</h2>
          <form className="space-y-3" onSubmit={(e) => void changePassword(e)}>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                {titleCase("Current password")}
              </label>
              <PasswordInput
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                {titleCase("New password")}
              </label>
              <PasswordInput
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                {titleCase("Confirm new password")}
              </label>
              <PasswordInput
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <button data-testid="profile-change-password-btn" type="submit" className="btn-secondary" disabled={busy || !currentPassword || newPassword.length < 8}>
              {busy ? titleCase("Updating…") : titleCase("Update password")}
            </button>
          </form>
        </div>
      ) : (
        <div className="card p-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            {titleCase("You sign in with Google. Manage your password in your Google account settings.")}
          </p>
        </div>
      )}
    </div>
  );
}
