import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { resolveMailboxOwnerId } from "@/lib/team-scope";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listOrSeedStages } from "@/lib/crm-stages";
import { DEFAULT_CRM_SETTINGS, type CrmSettings } from "@/lib/crm-settings";
import { gatherLeadEvidence } from "@/lib/crm-evidence";
import { classifyLeads, type ClassifiableLead } from "@/lib/crm-classify";
import { recordAiUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Guard against a request accidentally classifying the entire board at once. */
const MAX_LEADS_PER_RUN = 60;

type LeadRow = ClassifiableLead & { email: string | null; phone: string | null; stage_set_by: string };

/**
 * POST /api/crm/classify — body: { leadIds?: string[], force?: boolean }
 *
 * Reads each lead's mail/WhatsApp/notes since the season cutoff and places it
 * in one of this user's own stages, against their own leads only — the board
 * is personal per signed-in user (0055), not shared with a team. This is the
 * only thing in the app that spends OpenAI tokens on the CRM, and it runs
 * only when explicitly invoked — on adding leads, or from the board's
 * re-classify button. Nothing sweeps in the background.
 *
 * Leads whose stage was set by a human are skipped unless `force` is set:
 * silently undoing a deliberate drag is worse than leaving a card stale.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { leadIds?: unknown; force?: unknown };
  const requestedIds =
    Array.isArray(body.leadIds) && body.leadIds.every((v) => typeof v === "string")
      ? (body.leadIds as string[])
      : null;
  const force = body.force === true;

  const { stages, error: stagesError } = await listOrSeedStages(supabase, user.id);
  if (stagesError) return NextResponse.json({ error: stagesError }, { status: 500 });

  const unsorted = stages.find((s) => s.is_unsorted) ?? null;
  if (stages.filter((s) => !s.is_unsorted).length === 0) {
    return NextResponse.json(
      { error: "Add at least one column before classifying." },
      { status: 400 }
    );
  }

  const { data: settingsRow } = await supabase
    .from("crm_settings")
    .select("season_start_date, model, confidence_threshold")
    .eq("user_id", user.id)
    .maybeSingle();
  const settings = (settingsRow as CrmSettings | null) ?? DEFAULT_CRM_SETTINGS;

  // Explicit user_id filter, not left to RLS alone — leads' own RLS (0048)
  // still lets an admin read their whole team's rows for other features
  // (the Contacts directory's Status column). Without this, an admin's
  // "classify" run could reach into a teammate's leads too.
  let query = supabase
    .from("leads")
    .select("id, company_name, contact_name, email, phone, stage_set_by")
    .eq("user_id", user.id)
    .limit(MAX_LEADS_PER_RUN);
  if (requestedIds) query = query.in("id", requestedIds);

  const { data: leadRows, error: leadsError } = await query;
  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });

  const candidates = ((leadRows ?? []) as LeadRow[]).filter(
    (l) => force || l.stage_set_by !== "human"
  );
  if (candidates.length === 0) {
    return NextResponse.json({ classified: 0, parked: 0, skipped: (leadRows ?? []).length, costUsd: 0 });
  }

  // Mail is fetched live from Gmail; without a token we still classify on
  // WhatsApp + notes rather than failing the whole run.
  const auth = await requireGmailAccessToken(request);
  const accessToken = auth.ok ? auth.accessToken : undefined;
  const ownAddress = auth.ok ? auth.gmailAddress : undefined;
  const gmailMailboxKey = auth.ok ? auth.mailboxOwnerId : undefined;

  try {
    const withEvidence = [];
    for (const lead of candidates) {
      const evidence = await gatherLeadEvidence(
        supabase,
        { id: lead.id, email: lead.email, phone: lead.phone },
        {
          accessToken,
          mailboxKey: gmailMailboxKey,
          ownAddress,
          seasonStart: settings.season_start_date,
        }
      );
      withEvidence.push({
        lead: { id: lead.id, company_name: lead.company_name, contact_name: lead.contact_name },
        evidence,
      });
    }

    const result = await classifyLeads(
      settings.model,
      stages,
      settings.season_start_date,
      withEvidence
    );

    // Cost tracking stays team-visible even though the board itself is now
    // personal (0055) — an admin reasonably still wants to see the whole
    // team's AI spend in one place, so this still resolves and records the
    // team ledger key even though nothing else in this route uses it.
    const mailboxOwnerId = await resolveMailboxOwnerId(supabase, user.id);
    const costUsd = await recordAiUsage({
      userId: user.id,
      mailboxOwnerId,
      feature: "crm-classify",
      model: settings.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      refId: `leads:${candidates.length}`,
    });

    let classified = 0;
    let parked = 0;
    const now = new Date().toISOString();

    for (const v of result.verdicts) {
      const confident = v.stageId !== null && v.confidence >= settings.confidence_threshold;
      const targetStage = confident ? v.stageId : (unsorted?.id ?? null);
      if (confident) classified++;
      else parked++;

      await supabase
        .from("leads")
        .update({
          stage_id: targetStage,
          stage_set_by: "ai",
          ai_confidence: v.confidence,
          ai_rationale: v.rationale,
          ai_classified_at: now,
          stage_updated_at: now,
          updated_at: now,
        })
        .eq("id", v.leadId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      classified,
      parked,
      skipped: (leadRows ?? []).length - candidates.length,
      costUsd,
      model: settings.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      mailIncluded: Boolean(accessToken),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Classification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
