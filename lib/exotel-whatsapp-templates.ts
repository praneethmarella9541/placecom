import "server-only";

import {
  getExotelApiHostCandidates,
  getExotelBasicAuthHeader,
  getExotelCredentials,
} from "@/lib/exotel-config";

export type ExotelWhatsAppTemplateRow = {
  name: string;
  language: string;
  status: string;
  bodyText: string;
  bodyParamCount: number;
};

function normalizeTemplateText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\{\{(\d+)\}\}/g, "{{}}")
    .replace(/\{(\d+)\}/g, "{{}}")
    .replace(/\s+/g, " ")
    .trim();
}

function countBodyParams(text: string): number {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? text.match(/\{(\d+)\}/g);
  if (!matches?.length) return 0;
  let max = 0;
  for (const m of matches) {
    const n = Number.parseInt(m.replace(/\D/g, ""), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

function extractBodyText(components: unknown): string {
  if (!Array.isArray(components)) return "";
  for (const c of components) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (String(o.type ?? "").toUpperCase() !== "BODY") continue;
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

function parseExotelTemplatesPayload(json: Record<string, unknown>): ExotelWhatsAppTemplateRow[] {
  const out: ExotelWhatsAppTemplateRow[] = [];
  const response = json.response;
  if (!response || typeof response !== "object") return out;
  const whatsapp = (response as Record<string, unknown>).whatsapp;
  if (!whatsapp || typeof whatsapp !== "object") return out;
  const templates = (whatsapp as Record<string, unknown>).templates;
  if (!Array.isArray(templates)) return out;

  for (const item of templates) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.status === "failure") continue;
    const data = row.data;
    if (!data || typeof data !== "object") continue;
    const d = data as Record<string, unknown>;
    const name = typeof d.name === "string" ? d.name.trim() : "";
    const language = typeof d.language === "string" ? d.language.trim() : "en";
    const status = typeof d.status === "string" ? d.status.trim().toUpperCase() : "";
    if (!name || status !== "APPROVED") continue;
    const bodyText = extractBodyText(d.components);
    out.push({
      name,
      language,
      status,
      bodyText,
      bodyParamCount: Math.max(1, countBodyParams(bodyText)),
    });
  }
  return out;
}

/** List WABA IDs linked to this Exotel account. */
export async function fetchExotelWabaIds(): Promise<string[]> {
  const creds = getExotelCredentials();
  if (!creds) return [];

  const auth = getExotelBasicAuthHeader(creds);
  for (const host of getExotelApiHostCandidates()) {
    const url = `https://${host}/v2/accounts/${creds.sid}/wabas`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const response = json.response;
      if (!response || typeof response !== "object") continue;
      const whatsapp = (response as Record<string, unknown>).whatsapp;
      if (!whatsapp || typeof whatsapp !== "object") continue;
      const wabas = (whatsapp as Record<string, unknown>).wabas;
      if (!Array.isArray(wabas)) continue;
      const ids: string[] = [];
      for (const item of wabas) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (row.status === "failure") continue;
        const data = row.data;
        if (!data || typeof data !== "object") continue;
        const wabaId = (data as Record<string, unknown>).waba_id;
        if (typeof wabaId === "string" && wabaId.trim()) ids.push(wabaId.trim());
      }
      if (ids.length) return ids;
    } catch {
      continue;
    }
  }
  return [];
}

/** Fetch approved WhatsApp templates from Exotel (requires waba_id). */
export async function fetchExotelWhatsAppTemplates(
  wabaId: string
): Promise<ExotelWhatsAppTemplateRow[]> {
  const creds = getExotelCredentials();
  if (!creds) return [];

  const auth = getExotelBasicAuthHeader(creds);
  const params = new URLSearchParams({
    waba_id: wabaId,
    limit: "50",
    status: "APPROVED",
  });

  for (const host of getExotelApiHostCandidates()) {
    for (const pathPrefix of [`/v2/accounts/${creds.sid}`, `/v1/Accounts/${creds.sid}`]) {
      const url = `https://${host}${pathPrefix}/templates?${params.toString()}`;
      try {
        const res = await fetch(url, {
          headers: { Authorization: auth, Accept: "application/json" },
          cache: "no-store",
        });
        const text = await res.text();
        let json: Record<string, unknown> = {};
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          continue;
        }
        const rows = parseExotelTemplatesPayload(json);
        if (rows.length > 0) return rows;
        if (res.ok) return rows;
      } catch {
        continue;
      }
    }
  }
  return [];
}

/** Approved templates across configured WABA(s) or all account WABAs. */
export async function fetchExotelWhatsAppTemplatesResolved(): Promise<ExotelWhatsAppTemplateRow[]> {
  const explicit = process.env.EXOTEL_WABA_ID?.trim();
  const wabaIds = explicit ? [explicit] : await fetchExotelWabaIds();
  const seen = new Set<string>();
  const out: ExotelWhatsAppTemplateRow[] = [];

  for (const wabaId of wabaIds) {
    const rows = await fetchExotelWhatsAppTemplates(wabaId);
    for (const row of rows) {
      const key = `${row.name}::${row.language}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function matchExotelTemplate(
  config: { name: string; preview: string; matchText?: string },
  exotelRows: ExotelWhatsAppTemplateRow[]
): ExotelWhatsAppTemplateRow | undefined {
  const byName = exotelRows.find((r) => r.name === config.name);
  if (byName) return byName;

  const needle = normalizeTemplateText(config.matchText || config.preview);
  if (!needle) return undefined;

  const byBody = exotelRows.find((r) => {
    const body = normalizeTemplateText(r.bodyText);
    return body === needle || body.includes(needle) || needle.includes(body);
  });
  if (byBody) return byBody;

  const shortNeedle = needle.slice(0, 72);
  return exotelRows.find((r) =>
    normalizeTemplateText(r.bodyText).includes(shortNeedle)
  );
}
