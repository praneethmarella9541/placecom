/** Shared template metadata (safe for client + server). */

export type WhatsAppTemplateMeta = {
  name: string;
  languageCode: string;
  bodyParamCount: number;
  /** Human label in the template picker. */
  label: string;
  /** Example preview with {{1}}, {{2}}, … placeholders. */
  preview: string;
};

export function applyTemplatePreview(
  template: Pick<WhatsAppTemplateMeta, "name" | "preview">,
  variables: string[]
): string {
  const vars = variables.map((v) => v.trim()).filter(Boolean);
  if (template.preview.includes("{{")) {
    let out = template.preview;
    for (let i = 0; i < vars.length; i++) {
      out = out.split(`{{${i + 1}}}`).join(vars[i]!);
    }
    return out;
  }
  if (template.name === "initial_conversation" && vars.length >= 2) {
    return `Hi ${vars[0]}, this is ${vars[1]} from PlaceCom`;
  }
  return `[Template: ${template.name}] ${vars.join(" · ")}`;
}

export function templateVariableLabels(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["{{1}} Value"];
  if (count === 2) return ["{{1}} Recipient name", "{{2}} Your name"];
  return Array.from({ length: count }, (_, i) => `{{${i + 1}}} Value`);
}

/** Human-readable field labels for the UI only — does not affect API sends. */
export function templateVariableDisplayLabels(
  template: Pick<WhatsAppTemplateMeta, "bodyParamCount" | "preview" | "name">
): string[] {
  const count = template.bodyParamCount;
  if (count <= 0) return [];

  const inferred = inferParamLabelsFromPreview(template.preview, count);
  if (inferred.every(Boolean)) return inferred;

  if (count === 1) return ["Value"];
  if (count === 2) return ["Recipient name", "Your name"];
  return Array.from({ length: count }, (_, i) => `Field ${i + 1}`);
}

function inferParamLabelsFromPreview(preview: string, count: number): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= count; i++) {
    const token = `{{${i}}}`;
    const idx = preview.indexOf(token);
    if (idx < 0) {
      labels.push(`Field ${i}`);
      continue;
    }
    const before = preview.slice(Math.max(0, idx - 48), idx).toLowerCase();
    if (/\bhi\s*$|\bhello\s*$|\bdear\s*$/.test(before) || (i === 1 && count > 1)) {
      labels.push("Recipient name");
    } else if (/\bthis is\s*$|\bi am\s*$|\bi'm\s*$|\bfrom\s*$/.test(before)) {
      labels.push("Your name");
    } else if (/\bconfirm\s*$|\benter\s*$|\bprovide\s*$/.test(before)) {
      labels.push("Details");
    } else {
      labels.push(`Field ${i}`);
    }
  }
  return labels;
}

/** Strip {{1}}-style prefixes if they appear in a label string. */
export function stripTemplatePlaceholderNotation(label: string): string {
  return label.replace(/^\{\{\d+\}\}\s*/i, "").trim();
}
