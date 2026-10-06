/**
 * Who may open /configs and change platform module toggles.
 *
 * The allowlist lives only in CONFIGS_ALLOWED_EMAILS (server env, deliberately
 * NOT prefixed NEXT_PUBLIC_ so the list never reaches the browser). It is not
 * editable from the UI on purpose: /configs can switch whole products off for
 * every user, so the set of people who can do that should not itself be
 * editable by someone who already has access. Changing it is a deploy.
 *
 * Example:
 *   CONFIGS_ALLOWED_EMAILS=you@thenucleus.in,cofounder@thenucleus.in
 */

/**
 * Parsed, lower-cased allowlist. Empty means nobody — /configs is closed.
 *
 * Tolerates a value accidentally written as a JSON array
 * (`["a@b.com","c@d.com"]`) by stripping brackets and quotes, because the
 * failure mode is otherwise silent: the whole string becomes one entry that
 * matches no address, and /configs just stays shut with no hint why. This only
 * normalizes punctuation — anything that is not an address still fails to
 * match, so the gate remains fail-closed.
 */
export function configsAllowedEmails(): string[] {
  const raw = process.env.CONFIGS_ALLOWED_EMAILS;
  if (!raw?.trim()) return [];
  return raw
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

export function isConfigsEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = configsAllowedEmails();
  if (!allowed.length) return false;
  return allowed.includes(email.trim().toLowerCase());
}

/** True when /configs is reachable at all on this deployment. */
export function isConfigsEnabled(): boolean {
  return configsAllowedEmails().length > 0;
}

export const CONFIGS_PATH = "/configs";
export const CONFIGS_API_PREFIX = "/api/configs";

export function isConfigsPath(pathname: string): boolean {
  return (
    pathname === CONFIGS_PATH ||
    pathname.startsWith(`${CONFIGS_PATH}/`) ||
    pathname.startsWith(CONFIGS_API_PREFIX)
  );
}
