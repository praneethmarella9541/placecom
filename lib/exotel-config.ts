import "server-only";

/** Regional API hosts (must match Exotel Dashboard → Settings → API). */
export const EXOTEL_API_HOSTS = {
  singapore: "api.exotel.com",
  mumbai: "api.in.exotel.com",
} as const;

export type ExotelCredentials = {
  sid: string;
  apiKey: string;
  apiToken: string;
};

export function getExotelCredentials(): ExotelCredentials | null {
  const sid =
    process.env.EXOTEL_SID?.trim() || process.env.EXOTEL_ACCOUNT_SID?.trim() || "";
  const apiKey = process.env.EXOTEL_API_KEY?.trim() || "";
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim() || "";
  if (!sid || !apiKey || !apiToken) return null;
  return { sid, apiKey, apiToken };
}

/**
 * API host for Exotel requests. Defaults to Singapore.
 * India accounts: set EXOTEL_API_HOST=api.in.exotel.com in Vercel.
 */
export function getExotelApiHost(): string {
  const explicit = process.env.EXOTEL_API_HOST?.trim();
  if (explicit) return explicit.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cluster = process.env.EXOTEL_CLUSTER?.trim().toLowerCase();
  if (cluster === "mumbai" || cluster === "in" || cluster === "india") {
    return EXOTEL_API_HOSTS.mumbai;
  }
  return EXOTEL_API_HOSTS.singapore;
}

/** Hosts to try when EXOTEL_API_HOST is not set (401 often means wrong region). */
export function getExotelApiHostCandidates(): string[] {
  if (process.env.EXOTEL_API_HOST?.trim()) {
    return [getExotelApiHost()];
  }
  return [EXOTEL_API_HOSTS.singapore, EXOTEL_API_HOSTS.mumbai];
}

export function getExotelBasicAuthHeader(creds: ExotelCredentials): string {
  return `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiToken}`).toString("base64")}`;
}

export function parseExotelErrorBody(json: unknown, status: number): string {
  if (!json || typeof json !== "object") {
    return `Exotel request failed (${status})`;
  }
  const o = json as Record<string, unknown>;
  const rest = o.RestException as { Message?: string; Status?: number } | undefined;
  if (rest?.Message) return rest.Message;
  if (typeof o.message === "string" && o.message) return o.message;
  if (typeof o.error === "string" && o.error) return o.error;
  if (status === 401) {
    return (
      "Exotel authentication failed (401). In Vercel, verify EXOTEL_API_KEY and EXOTEL_API_TOKEN " +
      "(Dashboard → Settings → API), and set EXOTEL_API_HOST to your cluster: api.exotel.com (Singapore) " +
      "or api.in.exotel.com (Mumbai). This app uses api.exotel.com by default."
    );
  }
  return `Exotel request failed (${status})`;
}
