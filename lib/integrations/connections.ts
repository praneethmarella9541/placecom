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
};

const COLUMNS =
  "id, mailbox_owner_id, provider, api_key_encrypted, key_hint, status, connected_by, connected_at, last_checked_at, last_error, usage";

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
  };
}

export async function getConnectionRow(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<ConnectionRow | null> {
  const { data } = await svc
    .from("integration_connections")
    .select(COLUMNS)
    .eq("mailbox_owner_id", ownerId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
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

  const { data, error } = await svc
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
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message || "Could not save the connection.");
  return toPublic(data as ConnectionRow);
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
  const { data } = await svc
    .from("integration_connections")
    .update(patch)
    .eq("mailbox_owner_id", ownerId)
    .eq("provider", provider)
    .select(COLUMNS)
    .maybeSingle();
  return data ? toPublic(data as ConnectionRow) : null;
}

export async function removeConnection(
  svc: SupabaseClient,
  ownerId: string,
  provider: ConnectorProvider,
): Promise<void> {
  await svc.from("integration_connections").delete().eq("mailbox_owner_id", ownerId).eq("provider", provider);
}
