"use client";

import { useEffect, useState } from "react";
import type { MeProfileResponse } from "@/app/api/me/profile/route";
import { PasswordInput } from "@/components/PasswordInput";
import { titleCase } from "@/lib/title-case";
import { formatPhone } from "@/lib/wa-contacts-display";
import { patchMeMailboxCache, refreshMeMailbox } from "@/lib/use-me-mailbox";
import { gmailAvatarInitials } from "@/lib/gmail-avatar";

export function ProfileSettings() {
  const [profile, setProfile] = useState<MeProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [displayUsername, setDisplayUsername] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [bio, setBio] = useState("");

  // Last-saved values, used to detect unsaved edits so "Save profile" is
  // only active when something actually changed.
  const [savedDisplayUsername, setSavedDisplayUsername] = useState("");
  const [savedJobTitle, setSavedJobTitle] = useState("");
  const [savedBio, setSavedBio] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/me/profile");
        const data = (await res.json()) as MeProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load profile");
        setProfile(data);
        setDisplayUsername(data.displayUsername ?? "");
        setJobTitle(data.jobTitle ?? "");
        setBio(data.bio ?? "");
        setSavedDisplayUsername(data.displayUsername ?? "");
        setSavedJobTitle(data.jobTitle ?? "");
        setSavedBio(data.bio ?? "");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const profileDirty =
    displayUsername !== savedDisplayUsername || jobTitle !== savedJobTitle || bio !== savedBio;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileDirty) return;
    setSavingProfile(true);
    setProfileMsg(null);
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
      setProfileMsg("Profile updated.");
      setProfile((prev) => (prev ? { ...prev, displayUsername, jobTitle: jobTitle || null, bio: bio || null } : prev));
      setSavedDisplayUsername(displayUsername);
      setSavedJobTitle(jobTitle);
      setSavedBio(bio);
      // Keep the sidebar/header's shared "me" cache in sync so the new display
      // name (and the avatar initial derived from it) shows up there without a
      // full page reload, then reconcile against the server.
      patchMeMailboxCache({ displayUsername });
      void refreshMeMailbox();
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSavingProfile(false);
    }
  }

  const passwordFieldsFilled = Boolean(currentPassword && newPassword && confirmPassword);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New passwords do not match.");
      return;
    }
    setChangingPassword(true);
    setPasswordMsg(null);
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
      setPasswordMsg("Password updated.");
    } catch (e) {
      setPasswordMsg(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading profile…")}</p>;
  }

  if (!profile) {
    return <p className="text-sm text-[var(--color-danger)]">{loadError || titleCase("Could not load profile.")}</p>;
  }

  const tokenPct =
    profile.tokenLimit && profile.tokenLimit > 0
      ? Math.min(100, Math.round((profile.tokensUsed / profile.tokenLimit) * 100))
      : null;

  const initials = gmailAvatarInitials(displayUsername || profile.sessionEmail || "");

  return (
    <div className="space-y-4">
      {profileMsg && (
        <p
          className={`text-sm ${profileMsg.toLowerCase().includes("updated") ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
          role="status"
        >
          {profileMsg}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
        {/* ── Left: identity summary ─────────────────────────── */}
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <div className="flex items-center gap-3.5">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[17px] font-bold text-white"
                style={{
                  background: `linear-gradient(135deg, var(--color-copper-grad-from), var(--color-copper-grad-to))`,
                }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                  {displayUsername || titleCase("Unnamed")}
                </p>
                <p className="truncate text-[12.5px] text-[var(--color-text-muted)]">
                  {jobTitle || titleCase("No job title set")}
                </p>
              </div>
            </div>
            <dl className="space-y-2.5 border-t border-[var(--color-border)] pt-4 text-sm">
              <div>
                <dt className="text-xs font-bold text-[var(--color-text)]">{titleCase("Sign-in email")}</dt>
                <dd className="mt-0.5 text-[var(--color-text)]">{profile.sessionEmail || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[var(--color-text)]">{titleCase("Shared mailbox")}</dt>
                <dd className="mt-0.5 text-[var(--color-text)]">{profile.mailboxEmail || titleCase("Not linked yet")}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[var(--color-text)]">{titleCase("Assigned virtual number")}</dt>
                <dd className="mt-0.5 text-[var(--color-text)]">
                  {profile.exotelVirtualNumber
                    ? formatPhone(profile.exotelVirtualNumber)
                    : titleCase("Not assigned")}
                </dd>
              </div>
              {profile.groupName && (
                <div>
                  <dt className="text-xs font-bold text-[var(--color-text)]">{titleCase("Access group")}</dt>
                  <dd className="mt-0.5 text-[var(--color-text)]">{profile.groupName}</dd>
                </div>
              )}
            </dl>
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
                    className={`h-full rounded-full ${tokenPct >= 100 ? "bg-[var(--color-danger)]" : "bg-[var(--color-copper)]"}`}
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
        </div>

        {/* ── Right: editable settings ──────────────────────── */}
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("Your profile")}</h2>
            <form className="space-y-4" onSubmit={(e) => void saveProfile(e)}>
              <div className="grid gap-4 sm:grid-cols-2">
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
              <button
                data-testid="profile-save-btn"
                type="submit"
                className="btn-primary-copper"
                disabled={savingProfile || !profileDirty}
              >
                {savingProfile ? titleCase("Saving…") : titleCase("Save profile")}
              </button>
            </form>
          </div>

          {profile.canChangePassword ? (
            <div className="card space-y-4 p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{titleCase("Change password")}</h2>
              <form className="space-y-4" onSubmit={(e) => void changePassword(e)}>
                <div className="grid gap-4 sm:grid-cols-3">
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
                </div>
                {passwordMsg && (
                  <p
                    className={`text-sm ${passwordMsg.toLowerCase().includes("updated") ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
                    role="status"
                  >
                    {passwordMsg}
                  </p>
                )}
                <button
                  data-testid="profile-change-password-btn"
                  type="submit"
                  className="btn-secondary"
                  disabled={changingPassword || !passwordFieldsFilled || newPassword.length < 8}
                >
                  {changingPassword ? titleCase("Updating…") : titleCase("Update password")}
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
      </div>
    </div>
  );
}
