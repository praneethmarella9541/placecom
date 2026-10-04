import "server-only";

import {
  fetchExotelWhatsAppTemplatesResolved,
  matchExotelTemplate,
  type ExotelWhatsAppTemplateRow,
} from "@/lib/exotel-whatsapp-templates";
import type { WhatsAppTemplateConfig } from "@/lib/whatsapp-template";
import { loadWhatsAppTemplatesFromConfig } from "@/lib/whatsapp-template";

let _resolvedCache: { at: number; templates: WhatsAppTemplateConfig[] } | null = null;
const RESOLVE_TTL_MS = 5 * 60 * 1000;

function templateKey(name: string, languageCode: string): string {
  return `${name.trim()}::${languageCode.trim().toLowerCase()}`;
}

function humanizeTemplateName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Build a picker entry from a live Exotel template row (not in local config). */
export function exotelRowToWhatsAppTemplate(row: ExotelWhatsAppTemplateRow): WhatsAppTemplateConfig {
  const preview =
    row.bodyText.trim() ||
    (row.bodyParamCount >= 2
      ? `Hi {{1}}, this is {{2}}`
      : row.bodyParamCount === 1
        ? `{{1}}`
        : `[Template: ${row.name}]`);

  return {
    name: row.name,
    languageCode: row.language,
    bodyParamCount: row.bodyParamCount,
    label: humanizeTemplateName(row.name),
    preview,
  };
}

/** Merge config templates with live Exotel names/languages; append any other approved Exotel templates. */
export async function getWhatsAppTemplatesResolved(): Promise<WhatsAppTemplateConfig[]> {
  if (_resolvedCache && Date.now() - _resolvedCache.at < RESOLVE_TTL_MS) {
    return _resolvedCache.templates;
  }

  const base = loadWhatsAppTemplatesFromConfig();
  const exotel = await fetchExotelWhatsAppTemplatesResolved();
  if (!exotel.length) {
    _resolvedCache = { at: Date.now(), templates: base };
    return base;
  }

  const merged: WhatsAppTemplateConfig[] = base.map((cfg) => {
    const hit = matchExotelTemplate(cfg, exotel);
    if (!hit) return cfg;
    return {
      ...cfg,
      name: hit.name,
      languageCode: hit.language,
      bodyParamCount: hit.bodyParamCount || cfg.bodyParamCount,
      preview: hit.bodyText.trim() || cfg.preview,
    };
  });

  const seen = new Set(merged.map((t) => templateKey(t.name, t.languageCode)));
  for (const row of exotel) {
    const key = templateKey(row.name, row.language);
    if (seen.has(key)) continue;
    merged.push(exotelRowToWhatsAppTemplate(row));
    seen.add(key);
  }

  _resolvedCache = { at: Date.now(), templates: merged };
  return merged;
}

export async function resolveWhatsAppTemplateAsync(
  templateName?: string | null
): Promise<WhatsAppTemplateConfig> {
  const templates = await getWhatsAppTemplatesResolved();
  const name = templateName?.trim();
  if (name) {
    const hit = templates.find((t) => t.name === name);
    if (hit) return hit;
    const base = loadWhatsAppTemplatesFromConfig();
    const baseHit = base.find((t) => t.name === name);
    if (baseHit) {
      const resolved = templates.find(
        (t) => t.label === baseHit.label && t.preview === baseHit.preview
      );
      if (resolved) return resolved;
    }
  }
  return templates[0]!;
}

export function clearWhatsAppTemplateResolveCache(): void {
  _resolvedCache = null;
}
