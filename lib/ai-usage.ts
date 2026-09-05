import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { openaiCostUsd } from "@/lib/openai-pricing";

export type AiUsageInput = {
  userId: string | null;
  mailboxOwnerId: string | null;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  refId?: string | null;
};

/**
 * Appends one row to the AI spend ledger and returns the USD it cost.
 *
 * Written with the service role on purpose: ai_usage_events has a SELECT-only
 * policy (see the 0054 migration), so a signed-in user can read their team's
 * spend but cannot insert, edit or delete rows to hide it.
 *
 * Never throws. A ledger write failing must not fail the user's actual
 * request — the work is already done and the tokens already spent by the time
 * this runs; losing the audit row is strictly better than losing the result.
 * The cost is still returned so the caller can show it for this run.
 */
export async function recordAiUsage(input: AiUsageInput): Promise<number> {
  const costUsd = openaiCostUsd(input.model, input.inputTokens, input.outputTokens);
  try {
    const svc = createServiceSupabase();
    await svc.from("ai_usage_events").insert({
      user_id: input.userId,
      mailbox_owner_id: input.mailboxOwnerId,
      feature: input.feature,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cost_usd: costUsd,
      ref_id: input.refId ?? null,
    });
  } catch (e) {
    console.error("recordAiUsage: ledger write failed", e);
  }
  return costUsd;
}
