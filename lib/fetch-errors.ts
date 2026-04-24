/** Browser `fetch` throw when offline, CORS, or connection refused. */
export function clientFetchFailedMessage(err: unknown): string {
  if (err instanceof TypeError) {
    const m = err.message || "";
    if (/failed to fetch|fetch failed|networkerror|load failed/i.test(m)) {
      return (
        "Network error (could not reach this app\u2019s API). " +
        "Keep `npm run dev` running and use the same URL (e.g. http://localhost:3000)."
      );
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Turn opaque undici/browser "fetch failed" into actionable text for API routes.
 */
export function describeUpstreamFetchError(
  err: unknown,
  context: string
): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = e.message || "";
  const cause = (e as Error & { cause?: { code?: string; errno?: string } })
    .cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: string }).code)
      : "";

  if (msg === "fetch failed" || msg === "Failed to fetch") {
    const tail = code ? ` (${code})` : "";
    return `${context}: could not connect${tail}. Check the URL, that the service is running, firewall/VPN, and outbound HTTPS from Node.`;
  }

  return `${context}: ${msg}${code ? ` (${code})` : ""}`;
}
