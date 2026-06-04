import "server-only";

export type WhatsAppTemplateConfig = {
  name: string;
  languageCode: string;
  /** Number of body placeholders {{1}}, {{2}}, … in the template. */
  bodyParamCount: number;
};

export function getDefaultWhatsAppTemplate(): WhatsAppTemplateConfig {
  return {
    name: process.env.EXOTEL_WHATSAPP_TEMPLATE_NAME?.trim() || "initial_conversation",
    languageCode: process.env.EXOTEL_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en",
    bodyParamCount: Math.max(
      1,
      Number.parseInt(process.env.EXOTEL_WHATSAPP_TEMPLATE_PARAM_COUNT ?? "2", 10) || 2
    ),
  };
}

/** Preview text stored in chat log after sending a template. */
export function formatTemplatePreview(
  config: WhatsAppTemplateConfig,
  variables: string[]
): string {
  const vars = variables.filter(Boolean);
  if (config.name === "initial_conversation" && vars.length >= 2) {
    return `Hi ${vars[0]}, this is ${vars[1]} from PlaceCom`;
  }
  return `[Template: ${config.name}] ${vars.join(" · ")}`;
}
