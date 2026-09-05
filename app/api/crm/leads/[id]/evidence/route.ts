import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { DEFAULT_CRM_SETTINGS, type CrmSettings } from "@/lib/crm-settings";
import {
  DISPLAY_EVIDENCE_LIMITS,
  gatherLeadEvidence,
  type EvidenceItem,
} from "@/lib/crm-evidence";

export const runtime = "nodejs";

/**
 * GET /api/crm/leads/:id/evidence
 *
 * The same mail/WhatsApp/notes the classifier was given, for the lead detail
 * view — so a user can check the AI's reasoning against what it actually saw
 * rather than taking the rationale on faith.
 *
 * Deliberately re-fetched live rather than stored at classification time: the
 * point of the tab is "what is going on with this lead now", and a snapshot
 * would go stale the moment a new mail arrives. Reading costs nothing — no
 * model call happens here.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Explicit user_id filter: the board is personal per user (0055), so this
  // must not fall through to `leads`' own broader RLS (0048), which still
  // lets an admin read a teammate's row for other features (Contacts' Status
  // column). A missing row here means "not yours" as much as "doesn't exist".
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, email, phone")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: settingsRow } = await supabase
    .from("crm_settings")
    .select("season_start_date, model, confidence_threshold")
    .eq("user_id", user.id)
    .maybeSingle();
  const settings = (settingsRow as CrmSettings | null) ?? DEFAULT_CRM_SETTINGS;

  const auth = await requireGmailAccessToken(request);
  const evidence = await gatherLeadEvidence(
    supabase,
    { id: lead.id as string, email: lead.email as string | null, phone: lead.phone as string | null },
    {
      accessToken: auth.ok ? auth.accessToken : undefined,
      ownAddress: auth.ok ? auth.gmailAddress : undefined,
      seasonStart: settings.season_start_date,
      limits: DISPLAY_EVIDENCE_LIMITS,
    }
  );

  const byChannel = (channel: EvidenceItem["channel"]) =>
    evidence.items.filter((i) => i.channel === channel);

  return NextResponse.json({
    seasonStart: settings.season_start_date,
    mailIncluded: auth.ok,
    mailError: auth.ok ? null : auth.message,
    mail: byChannel("mail"),
    whatsapp: byChannel("whatsapp"),
    notes: byChannel("note"),
  });
}
