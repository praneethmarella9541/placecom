const KEY = "whatsapp_selected_template";

export function getSelectedWhatsAppTemplateName(): string | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY)?.trim();
  return v || null;
}

export function setSelectedWhatsAppTemplateName(name: string) {
  localStorage.setItem(KEY, name.trim());
}
