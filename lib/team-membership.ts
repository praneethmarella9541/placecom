/**
 * Who may use the workspace: an admin, or anyone an admin has linked to their
 * mailbox team (profiles.mailbox_owner_id — set when an admin adds them in
 * Admin → Team). A signed-in account with no profile, or a staff profile with
 * no team, is a stranger who only got as far as creating a login.
 */
export function isTeamMember(
  profile: { role?: string | null; mailbox_owner_id?: string | null } | null | undefined
): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  return Boolean(profile.mailbox_owner_id);
}

/** Where a signed-in non-member is sent. Not gated, so it can explain and offer sign-out. */
export const NO_ACCESS_PATH = "/no-access";

export const NOT_IN_TEAM_MESSAGE =
  "This email isn't part of a team. Ask your admin to add you, then sign in again.";
