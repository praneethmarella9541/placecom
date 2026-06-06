import "server-only";

import fs from "fs";
import path from "path";

import {
  applyTemplatePreview,
  type WhatsAppTemplateMeta,
} from "@/lib/whatsapp-template-shared";

const DEFAULT_TEMPLATES_FILE = path.join(
  process.cwd(),
  "config",
  "whatsapp-templates.json"
);

export type WhatsAppTemplateConfig = WhatsAppTemplateMeta;

function singleTemplateFromEnv(): WhatsAppTemplateConfig {
  const name =
    process.env.EXOTEL_WHATSAPP_TEMPLATE_NAME?.trim() || "initial_conversation";
  const languageCode =
    process.env.EXOTEL_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en";
  const bodyParamCount = Math.max(
    1,
    Number.parseInt(process.env.EXOTEL_WHATSAPP_TEMPLATE_PARAM_COUNT ?? "2", 10) ||
      2
  );
  const label =
    process.env.EXOTEL_WHATSAPP_TEMPLATE_LABEL?.trim() ||
    (name === "initial_conversation" ? "First outreach" : name);
  const preview =
    process.env.EXOTEL_WHATSAPP_TEMPLATE_PREVIEW?.trim() ||
    (name === "initial_conversation"
      ? "Hi {{1}}, this is {{2}} from PlaceCom"
      : `[Template: ${name}]`);

  return { name, languageCode, bodyParamCount, label, preview };
}

function parseTemplatesJson(raw: string): WhatsAppTemplateConfig[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out: WhatsAppTemplateConfig[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!name) continue;
      const languageCode =
        typeof o.languageCode === "string" && o.languageCode.trim()
          ? o.languageCode.trim()
          : "en";
      const bodyParamCount = Math.max(
        1,
        typeof o.bodyParamCount === "number"
          ? Math.floor(o.bodyParamCount)
          : Number.parseInt(String(o.bodyParamCount ?? "2"), 10) || 2
      );
      const label =
        typeof o.label === "string" && o.label.trim()
          ? o.label.trim()
          : name;
      const preview =
        typeof o.preview === "string" && o.preview.trim()
          ? o.preview.trim()
          : name === "initial_conversation"
            ? "Hi {{1}}, this is {{2}} from PlaceCom"
            : `[Template: ${name}]`;
      out.push({ name, languageCode, bodyParamCount, label, preview });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function loadTemplatesFromFile(): WhatsAppTemplateConfig[] | null {
  const filePath =
    process.env.WHATSAPP_TEMPLATES_FILE?.trim() || DEFAULT_TEMPLATES_FILE;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return parseTemplatesJson(raw);
  } catch {
    return null;
  }
}

let _cachedTemplates: WhatsAppTemplateConfig[] | null = null;

/** All approved templates configured for this deployment. */
export function getWhatsAppTemplates(): WhatsAppTemplateConfig[] {
  if (_cachedTemplates) return _cachedTemplates;

  const jsonRaw = process.env.EXOTEL_WHATSAPP_TEMPLATES?.trim();
  if (jsonRaw) {
    const parsed = parseTemplatesJson(jsonRaw);
    if (parsed) {
      _cachedTemplates = parsed;
      return parsed;
    }
  }

  const fromFile = loadTemplatesFromFile();
  if (fromFile) {
    _cachedTemplates = fromFile;
    return fromFile;
  }

  _cachedTemplates = [singleTemplateFromEnv()];
  return _cachedTemplates;
}

export function getDefaultWhatsAppTemplate(): WhatsAppTemplateConfig {
  return getWhatsAppTemplates()[0]!;
}

/** Resolve by Meta template name; falls back to default. */
export function resolveWhatsAppTemplate(
  templateName?: string | null
): WhatsAppTemplateConfig {
  const name = templateName?.trim();
  if (name) {
    const hit = getWhatsAppTemplates().find((t) => t.name === name);
    if (hit) return hit;
  }
  return getDefaultWhatsAppTemplate();
}

/** Preview text stored in chat log after sending a template. */
export function formatTemplatePreview(
  config: WhatsAppTemplateConfig,
  variables: string[]
): string {
  return applyTemplatePreview(config, variables);
}

export function serializeTemplatesForClient(): WhatsAppTemplateMeta[] {
  return getWhatsAppTemplates().map((t) => ({
    name: t.name,
    languageCode: t.languageCode,
    bodyParamCount: t.bodyParamCount,
    label: t.label,
    preview: t.preview,
  }));
}
