/** What Placecom + Exotel WhatsApp can do today (session = 24h after customer replies). */

export type WhatsAppFeatureId =
  | "text"
  | "template"
  | "image"
  | "video"
  | "document"
  | "audio"
  | "location"
  | "interactive_buttons"
  | "groups";

export type WhatsAppFeature = {
  id: WhatsAppFeatureId;
  label: string;
  available: boolean;
  requiresSession: boolean;
  note?: string;
};

export function listWhatsAppFeatures(): WhatsAppFeature[] {
  return [
    { id: "text", label: "Text messages", available: true, requiresSession: true },
    { id: "template", label: "Approved templates (open chat)", available: true, requiresSession: false },
    { id: "image", label: "Images", available: true, requiresSession: true },
    { id: "video", label: "Videos", available: true, requiresSession: true },
    { id: "document", label: "Documents (PDF, etc.)", available: true, requiresSession: true },
    { id: "audio", label: "Audio / voice notes", available: true, requiresSession: true },
    { id: "location", label: "Location pin", available: true, requiresSession: true },
    {
      id: "interactive_buttons",
      label: "Quick reply buttons (up to 3)",
      available: true,
      requiresSession: true,
    },
    {
      id: "groups",
      label: "Group create & group chat",
      available: false,
      requiresSession: true,
      note:
        "WhatsApp groups via API need Meta Official Business Account (OBA), very high messaging limits, and Exotel/Meta group setup. Exotel send API currently documents individual recipients only. Use broadcast or multiple 1:1 chats until groups are enabled on your WABA.",
    },
  ];
}
