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
