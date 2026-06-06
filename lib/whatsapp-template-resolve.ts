import "server-only";

import {
  fetchExotelWhatsAppTemplatesResolved,
  matchExotelTemplate,
} from "@/lib/exotel-whatsapp-templates";
import type { WhatsAppTemplateConfig } from "@/lib/whatsapp-template";
import { loadWhatsAppTemplatesFromConfig } from "@/lib/whatsapp-template";

let _resolvedCache: { at: number; templates: WhatsAppTemplateConfig[] } | null = null;
const RESOLVE_TTL_MS = 5 * 60 * 1000;

/** Merge config templates with live Exotel names/languages when EXOTEL_WABA_ID is set. */
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

  const merged = base.map((cfg) => {
    const hit = matchExotelTemplate(cfg, exotel);
    if (!hit) return cfg;
    return {
      ...cfg,
      name: hit.name,
      languageCode: hit.language,
      bodyParamCount: hit.bodyParamCount || cfg.bodyParamCount,
    };
  });

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
