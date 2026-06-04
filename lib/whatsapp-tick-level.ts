export type WhatsAppTickLevel = "pending" | "sent" | "delivered" | "read" | "failed";

export function getWhatsAppTickLevel(deliveryStatus: string | null | undefined): WhatsAppTickLevel {
  const s = (deliveryStatus ?? "").trim().toLowerCase();
  if (!s || s === "pending") return "pending";
  if (s.startsWith("failed")) return "failed";
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  return "sent";
}
