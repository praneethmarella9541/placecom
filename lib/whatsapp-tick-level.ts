export type WhatsAppTickLevel = "pending" | "sent" | "delivered" | "read" | "failed";

/** Normalize Exotel/Meta delivery strings to canonical DB values. */
export function normalizeWhatsAppDeliveryStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (!s || s === "pending" || s === "queued") return "pending";
  if (s.startsWith("failed") || s === "undelivered" || s === "rejected") {
    const trimmed = (raw ?? "").trim();
    return trimmed.toLowerCase().startsWith("failed") ? trimmed : `failed: ${trimmed}`;
  }
  if (s === "read" || s === "seen" || s === "message_seen" || s === "played") return "read";
  if (
    s === "delivered" ||
    s === "message_delivered" ||
    s === "delivery_ack" ||
    s === "delivery"
  ) {
    return "delivered";
  }
  if (s === "sent" || s === "accepted" || s === "message_sent") return "sent";
  return s;
}

export function deliveryStatusRank(status: string | null | undefined): number {
  const s = normalizeWhatsAppDeliveryStatus(status);
  if (s.startsWith("failed")) return -1;
  if (s === "read") return 3;
  if (s === "delivered") return 2;
  if (s === "sent") return 1;
  return 0;
}

export function getWhatsAppTickLevel(deliveryStatus: string | null | undefined): WhatsAppTickLevel {
  const s = normalizeWhatsAppDeliveryStatus(deliveryStatus);
  if (!s || s === "pending") return "pending";
  if (s.startsWith("failed")) return "failed";
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  return "sent";
}
