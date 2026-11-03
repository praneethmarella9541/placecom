/**
 * Database errors carry table, column and constraint names; they belong in the server log, not in
 * the JSON a browser receives. `dbErrorMessage` logs the real error and returns text that is safe
 * to show. Outside production it returns the real message so developers still see what failed.
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined;

const FRIENDLY: Record<string, string> = {
  "23505": "That already exists.",
  "23503": "That is linked to other records, so it can't be changed.",
  "23502": "A required value is missing.",
  "22P02": "A value has the wrong format.",
  "42501": "You don't have permission to do that.",
  PGRST116: "Not found.",
};

export const GENERIC_DB_ERROR = "Something went wrong. Please try again.";

export function dbErrorMessage(err: DbError, fallback: string = GENERIC_DB_ERROR): string {
  console.error("[api] database error:", err?.code ?? "", err?.message ?? "");
  if (process.env.NODE_ENV !== "production") return err?.message || fallback;
  return (err?.code && FRIENDLY[err.code]) || fallback;
}
