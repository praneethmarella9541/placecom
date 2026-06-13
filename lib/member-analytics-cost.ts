import { callTalkSecondsFromRow, type CallTalkRow } from "@/lib/call-talk-seconds";
import { getWhatsAppTemplates } from "@/lib/whatsapp-template";

/** Exotel / Meta billing rates (INR). */
export const CALL_RATE_INR_PER_MIN = 0.6;
export const WA_UTILITY_INR = 0.11;
export const WA_PROMOTIONAL_INR = 0.86;
export const WA_SESSION_INR = 0.06;

export type WhatsAppBillingKind = "utility" | "promotional" | "session";

export type UsageCosts = {
  callsInr: number;
  whatsappInr: number;
  totalInr: number;
  callBillableMinutes: number;
  whatsappUtilityMsgs: number;
  whatsappPromotionalMsgs: number;
  whatsappSessionMsgs: number;
};

export function emptyUsageCosts(): UsageCosts {
  return {
    callsInr: 0,
    whatsappInr: 0,
    totalInr: 0,
    callBillableMinutes: 0,
    whatsappUtilityMsgs: 0,
    whatsappPromotionalMsgs: 0,
    whatsappSessionMsgs: 0,
  };
}

export function roundInr(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Billable talk time per call — round up to the next whole minute. */
export function callBillableMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

export function callCostInr(seconds: number): number {
  return roundInr(callBillableMinutes(seconds) * CALL_RATE_INR_PER_MIN);
}

function templateCategoryFromConfig(templateName: string | null | undefined): WhatsAppBillingKind | null {
  const name = templateName?.trim();
  if (!name) return null;
  const templates = getWhatsAppTemplates();
  const hit = templates.find((t) => t.name === name);
  if (!hit) return name === "utility" ? "utility" : "promotional";
  const category = (hit as { category?: string }).category?.trim().toLowerCase();
  if (category === "utility") return "utility";
  if (category === "promotional" || category === "marketing") return "promotional";
  return name === "utility" ? "utility" : "promotional";
}

function parseTemplateNameFromBody(body: string | null | undefined): string | null {
  const text = (body ?? "").trim();
  const m = text.match(/^\[Template:\s*([^\]]+)\]/i);
  return m?.[1]?.trim() || null;
}

/** Classify a WhatsApp row for billing. */
export function whatsappBillingKind(input: {
  content_type?: string | null;
  template_name?: string | null;
  body?: string | null;
}): WhatsAppBillingKind {
  const contentType = (input.content_type ?? "").trim().toLowerCase();
  if (contentType !== "template") return "session";

  const fromDb = templateCategoryFromConfig(input.template_name);
  if (fromDb) return fromDb;

  const fromBody = templateCategoryFromConfig(parseTemplateNameFromBody(input.body));
  if (fromBody) return fromBody;

  // Legacy template logs stored only the filled preview text.
  const body = (input.body ?? "").toLowerCase();
  if (body.includes("xlri placecom team")) return "utility";

  return "promotional";
}

export function whatsappMessageCostInr(input: {
  content_type?: string | null;
  template_name?: string | null;
  body?: string | null;
}): { kind: WhatsAppBillingKind; costInr: number } {
  const kind = whatsappBillingKind(input);
  const rate =
    kind === "utility" ? WA_UTILITY_INR : kind === "promotional" ? WA_PROMOTIONAL_INR : WA_SESSION_INR;
  return { kind, costInr: roundInr(rate) };
}

export function addWhatsAppCost(acc: UsageCosts, input: {
  content_type?: string | null;
  template_name?: string | null;
  body?: string | null;
}): void {
  const { kind, costInr } = whatsappMessageCostInr(input);
  acc.whatsappInr = roundInr(acc.whatsappInr + costInr);
  acc.totalInr = roundInr(acc.totalInr + costInr);
  if (kind === "utility") acc.whatsappUtilityMsgs += 1;
  else if (kind === "promotional") acc.whatsappPromotionalMsgs += 1;
  else acc.whatsappSessionMsgs += 1;
}

export function addCallCost(acc: UsageCosts, talkSeconds: number): void {
  const mins = callBillableMinutes(talkSeconds);
  if (mins <= 0) return;
  const cost = callCostInr(talkSeconds);
  acc.callBillableMinutes += mins;
  acc.callsInr = roundInr(acc.callsInr + cost);
  acc.totalInr = roundInr(acc.totalInr + cost);
}

export function callTalkSeconds(row: CallTalkRow): number {
  return callTalkSecondsFromRow(row);
}
