/**
 * Runs once when the Next.js server starts. Installs log redaction so no server-side log line can
 * carry credentials, tokens or payment details (CASA 6.5.1) — see lib/log-redaction.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installLogRedaction } = await import("./lib/log-redaction");
  installLogRedaction();
}
