import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import type { LushaUsage } from "@/lib/integrations/lusha";

export type ConnectorProvider = "lusha";
export type ConnectionStatus = "connected" | "invalid" | "inactive";

type ConnectionRow = {
  id: string;
  mailbox_owner_id: string;
  provider: ConnectorProvider;
  api_key_encrypted: string;
  key_hint: string;
  status: ConnectionStatus;
  connected_by: string | null;
  connected_at: string;
  last_checked_at: string | null;
  last_error: string | null;
  usage: LushaUsage | null;
  settings: ConnectorSettings | null;
};

/** Per-account connector settings, kept as JSON so new ones need no migration. */
export type ConnectorSettings = {
  /** Most credits one non-admin may spend a month; absent or null means no cap. */
  perUserMonthlyCap?: number | null;
};

/** What the browser may see: never the key, only whether and how it is connected. */
export type PublicConnection = {
  provider: ConnectorProvider;
  connected: boolean;
  status: ConnectionStatus | null;
  keyHint: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  usage: LushaUsage | null;
  settings: ConnectorSettings;
};

const BASE_COLUMNS =
  "id, mailbox_owner_id, provider, api_key_encrypted, key_hint, status, connected_by, connected_at, last_checked_at, last_error, usage";

/**
 * `settings` arrived in migration 0079. Until an environment has it, ask for the base columns only,
 * so a connection that was working keeps working while migrations are applied in their own time.
 */
let settingsColumnMissing = false;
function columns(): string {
  return settingsColumnMissing ? BASE_COLUMNS : `${BASE_COLUMNS}, settings`;
}

async function withColumns<T>(
  run: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  let res = await run(columns());
  if (res.error && !settingsColumnMissing && res.error.code === "42703" && /settings/i.test(res.error.message ?? "")) {
    settingsColumnMissing = true;
    res = await run(columns());
  }
  return res;
}

export function emptyConnection(provider: ConnectorProvider): PublicConnection {
  return {
    provider,
    connected: false,
    status: null,
    keyHint: null,
    connectedAt: null,
    lastCheckedAt: null,
    lastError: null,
    usage: null,
    settings: {},
  };
}

function toPublic(row: ConnectionRow): PublicConnection {
  return {
    provider: row.provider,
    connected: true,
    status: row.status,
    keyHint: row.key_hint,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    usage: row.usage,
    settings: row.settings ?? {},
  };
}

export async function getConnectionRow(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<ConnectionRow | null> {
  const { data } = await withColumns<ConnectionRow>((cols) =>
    svc
      .from("integration_connections")
      .select(cols)
      .eq("mailbox_owner_id", ownerId)
      .eq("provider", provider)
      .maybeSingle() as unknown as PromiseLike<{ data: ConnectionRow | null; error: { code?: string; message?: string } | null }>,
  );
  return data ?? null;
}

export async function getPublicConnection(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<PublicConnection> {
  const row = await getConnectionRow(svc, ownerId, provider);
  return row ? toPublic(row) : emptyConnection(provider);
}

/** The decrypted key for server-side calls, or null when the account has not connected one. */
export async function getProviderKey(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<string | null> {
  const row = await getConnectionRow(svc, ownerId, provider);
  if (!row || row.status !== "connected") return null;
  return decryptToken(row.api_key_encrypted);
}

/** Replace (or create) the account's connection. The key is encrypted before it touches the database. */
export async function saveConnection(
  svc: SupabaseClient,
  params: { ownerId: string; userId: string; provider: ConnectorProvider; apiKey: string; usage: LushaUsage | null },
): Promise<PublicConnection> {
  const now = new Date().toISOString();
  const encrypted = encryptToken(params.apiKey);
  if (!encrypted) throw new Error("Could not encrypt the API key.");

  const { data, error } = await withColumns<ConnectionRow>((cols) =>
    svc
    .from("integration_connections")
    .upsert(
      {
        mailbox_owner_id: params.ownerId,
        provider: params.provider,
        api_key_encrypted: encrypted,
        key_hint: params.apiKey.slice(-4),
        status: "connected",
        connected_by: params.userId,
        connected_at: now,
        last_checked_at: now,
        last_error: null,
        usage: params.usage,
        updated_at: now,
      },
      { onConflict: "mailbox_owner_id,provider" },
    )
    .select(cols)
    .single() as unknown as PromiseLike<{ data: ConnectionRow | null; error: { code?: string; message?: string } | null }>,
  );
  if (error || !data) throw new Error(error?.message || "Could not save the connection.");
  return toPublic(data);
}

/** Record the outcome of a re-check: fresh usage on success, or why the key stopped working. */
export async function recordCheck(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
  result: { usage: LushaUsage } | { status: ConnectionStatus; error: string },
): Promise<PublicConnection | null> {
  const now = new Date().toISOString();
  const patch =
    "usage" in result
      ? { status: "connected", usage: result.usage, last_error: null, last_checked_at: now, updated_at: now }
      : { status: result.status, last_error: result.error, last_checked_at: now, updated_at: now };
  const { data } = await withColumns<ConnectionRow>((cols) =>
    svc
      .from("integration_connections")
      .update(patch)
      .eq("mailbox_owner_id", ownerId)
      .eq("provider", provider)
      .select(cols)
      .maybeSingle() as unknown as PromiseLike<{ data: ConnectionRow | null; error: { code?: string; message?: string } | null }>,
  );
  return data ? toPublic(data) : null;
}

export async function removeConnection(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<void> {
  await svc.from("integration_connections").delete().eq("mailbox_owner_id", ownerId).eq("provider", provider);
}

/** Change the account's connector settings. Only the keys given are touched. */
export async function updateSettings(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
  patch: ConnectorSettings,
): Promise<PublicConnection | null> {
  const row = await getConnectionRow(svc, ownerId, provider);
  if (!row) return null;
  if (settingsColumnMissing) return null; // migration 0079 not applied yet
  const next = { ...(row.settings ?? {}), ...patch };
  const { data } = await withColumns<ConnectionRow>((cols) =>
    svc
      .from("integration_connections")
      .update({ settings: next, updated_at: new Date().toISOString() })
      .eq("mailbox_owner_id", ownerId)
      .eq("provider", provider)
      .select(cols)
      .maybeSingle() as unknown as PromiseLike<{ data: ConnectionRow | null; error: { code?: string; message?: string } | null }>,
  );
  return data ? toPublic(data) : null;
}

/**
 * After a call that spent credits, move the stored balance by what was spent, so the page shows a
 * current figure without spending one of Lusha's five balance checks a minute on every reveal.
 */
export async function noteSpend(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
  credits: number,
): Promise<void> {
  if (credits <= 0) return;
  const row = await getConnectionRow(svc, ownerId, provider);
  if (!row?.usage) return;
  const usage = {
    ...row.usage,
    credits: {
      ...row.usage.credits,
      used: row.usage.credits.used + credits,
      remaining: Math.max(0, row.usage.credits.remaining - credits),
    },
  };
  await svc
    .from("integration_connections")
    .update({ usage, updated_at: new Date().toISOString() })
    .eq("mailbox_owner_id", ownerId)
    .eq("provider", provider);
}
