import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";

type JobUsageRow = {
  openai_input_tokens: number | null;
  openai_output_tokens: number | null;
};

export type TokenLimitStatus = {
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
};

export async function getUserOpenAITokenUsage(userId: string): Promise<number> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return 0;
  }

  const { data, error } = await svc
    .from("extraction_jobs")
    .select("openai_input_tokens, openai_output_tokens")
    .eq("user_id", userId);

  if (error) return 0;

  let total = 0;
  for (const row of (data ?? []) as JobUsageRow[]) {
    total += (Number(row.openai_input_tokens) || 0) + (Number(row.openai_output_tokens) || 0);
  }
  return total;
}

export async function getUserTokenLimitStatus(userId: string): Promise<TokenLimitStatus> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return { limit: null, used: 0, remaining: null, exceeded: false };
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("openai_token_limit")
    .eq("id", userId)
    .maybeSingle();

  const limitRaw = profile?.openai_token_limit;
  const limit =
    limitRaw == null || limitRaw === "" ? null : Math.max(0, Number(limitRaw) || 0);
  const used = await getUserOpenAITokenUsage(userId);

  if (limit == null) {
    return { limit: null, used, remaining: null, exceeded: false };
  }

  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, exceeded: used >= limit };
}

export async function assertUserWithinTokenLimit(
  userId: string
): Promise<{ ok: true } | { ok: false; message: string; status: TokenLimitStatus }> {
  const status = await getUserTokenLimitStatus(userId);
  if (!status.exceeded) return { ok: true };
  return {
    ok: false,
    message: `OpenAI token limit reached (${status.used.toLocaleString()} / ${status.limit?.toLocaleString()}). Contact your admin to increase your allowance.`,
    status,
  };
}
