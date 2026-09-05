import "server-only";

import OpenAI from "openai";

import type { CrmStage } from "@/lib/crm-stages-types";
import { renderEvidence, type LeadEvidence } from "@/lib/crm-evidence";

export type ClassifiableLead = {
  id: string;
  company_name: string;
  contact_name: string | null;
};

export type LeadVerdict = {
  leadId: string;
  stageId: string | null;
  confidence: number;
  rationale: string;
};

export type ClassifyResult = {
  verdicts: LeadVerdict[];
  inputTokens: number;
  outputTokens: number;
};

/** Leads per OpenAI request. Small enough that one bad batch doesn't lose much work. */
const BATCH_SIZE = 8;

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey });
}

/**
 * The board's own columns are the label set — the user's stage descriptions
 * are the category definitions, so renaming a column genuinely changes what
 * the model is asked to do. Stage ids (not names) come back so a later rename
 * can't silently orphan verdicts.
 */
function systemPrompt(stages: CrmStage[], seasonStart: string | null): string {
  const catalogue = stages
    .filter((s) => !s.is_unsorted)
    .map((s) => `- id: ${s.id}\n  name: ${s.name}\n  belongs here when: ${s.description?.trim() || "(no description given — infer from the name)"}`)
    .join("\n");

  return [
    "You sort sales leads into pipeline stages for a recruitment/placement team.",
    "",
    "For each lead you are given its name and the recent communication with them",
    `(email subjects and snippets, WhatsApp messages, and manually logged notes)${
      seasonStart ? `, limited to activity on or after ${seasonStart}` : ""
    }.`,
    "",
    "The available stages are:",
    catalogue,
    "",
    "Rules:",
    "- Choose the single stage that best matches the evidence.",
    '- "we sent" means our team sent it; "they sent" means the lead did.',
    '- An item marked "(lead cc\'d, not addressed directly)" means the lead was only',
    "  looped in, not written to — real but weaker signal than a direct exchange.",
    "  Several cc's with no direct reply from the lead should not by itself read as",
    "  an active two-way conversation.",
    "- Base the decision only on the evidence shown. Do not invent activity.",
    "- confidence is 0 to 1: how sure you are this is the right stage.",
    "- If the evidence is empty, thin, or fits no stage well, return a low confidence",
    "  (below 0.5) rather than guessing — low-confidence leads are parked for human review.",
    "- rationale must be one short sentence citing what in the evidence decided it.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lead_id", "stage_id", "confidence", "rationale"],
        properties: {
          lead_id: { type: "string" },
          stage_id: { type: "string" },
          confidence: { type: "number" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

async function classifyBatch(
  openai: OpenAI,
  model: string,
  stages: CrmStage[],
  seasonStart: string | null,
  batch: { lead: ClassifiableLead; evidence: LeadEvidence }[]
): Promise<ClassifyResult> {
  const userContent = batch
    .map(({ lead, evidence }) =>
      [
        `LEAD id: ${lead.id}`,
        `Company: ${lead.company_name}`,
        lead.contact_name ? `Contact: ${lead.contact_name}` : null,
        "Evidence (newest first):",
        renderEvidence(evidence),
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt(stages, seasonStart) },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "lead_stages", strict: true, schema: RESPONSE_SCHEMA },
    },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { results?: unknown };
  try {
    parsed = JSON.parse(raw) as { results?: unknown };
  } catch {
    parsed = {};
  }

  const validStageIds = new Set(stages.filter((s) => !s.is_unsorted).map((s) => s.id));
  const byId = new Map(batch.map(({ lead }) => [lead.id, lead]));
  const verdicts: LeadVerdict[] = [];

  for (const row of Array.isArray(parsed.results) ? parsed.results : []) {
    const r = row as Record<string, unknown>;
    const leadId = typeof r.lead_id === "string" ? r.lead_id : "";
    if (!byId.has(leadId)) continue;
    const stageId = typeof r.stage_id === "string" && validStageIds.has(r.stage_id) ? r.stage_id : null;
    const confidenceRaw = Number(r.confidence);
    verdicts.push({
      leadId,
      // A hallucinated stage id is treated as "couldn't place it", not as an
      // error — the lead still gets parked rather than dropped from the run.
      stageId,
      confidence: Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0,
      rationale: typeof r.rationale === "string" ? r.rationale.trim().slice(0, 500) : "",
    });
  }

  return {
    verdicts,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

/**
 * Classifies leads in batches, summing token usage across every call so the
 * caller can price the whole run once. Batches run sequentially: a
 * re-classify is a handful of requests at most, and a serial loop keeps this
 * well clear of rate limits without needing the concurrency pool that the
 * much larger extraction runs use.
 */
export async function classifyLeads(
  model: string,
  stages: CrmStage[],
  seasonStart: string | null,
  leads: { lead: ClassifiableLead; evidence: LeadEvidence }[]
): Promise<ClassifyResult> {
  if (leads.length === 0) return { verdicts: [], inputTokens: 0, outputTokens: 0 };

  const openai = client();
  const all: LeadVerdict[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const res = await classifyBatch(openai, model, stages, seasonStart, batch);
    all.push(...res.verdicts);
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
  }

  return { verdicts: all, inputTokens, outputTokens };
}
