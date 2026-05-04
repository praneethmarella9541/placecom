import "server-only";

/** True when PostgREST reports the new mailbox tables are not in the DB yet (teammates can stay on old migrations). */
export function isMailboxMigrationNotApplied(err: {
  message?: string;
  code?: string;
  details?: string;
}): boolean {
  const m = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  const code = String(err.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  if (m.includes("schema cache") && (m.includes("profiles") || m.includes("google_mailbox_credentials"))) {
    return true;
  }
  if (
    (m.includes("profiles") || m.includes("google_mailbox_credentials")) &&
    (m.includes("does not exist") || m.includes("could not find"))
  ) {
    return true;
  }
  return false;
}
