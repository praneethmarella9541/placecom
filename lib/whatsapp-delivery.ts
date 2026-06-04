/** Label for outbound bubble / message info. */
export function formatWhatsAppDeliveryLabel(deliveryStatus: string | null | undefined): string | null {
  const s = (deliveryStatus ?? "").trim();
  if (!s) return null;
  if (s === "sent") return "Sent to WhatsApp";
  if (s === "delivered") return "Delivered";
  if (s === "read") return "Read";
  if (s.startsWith("failed")) {
    const detail = s.replace(/^failed:\s*/i, "").trim();
    return detail ? `Not delivered — ${detail}` : "Not delivered";
  }
  return s;
}

export function isWhatsAppDeliveryFailed(deliveryStatus: string | null | undefined): boolean {
  return (deliveryStatus ?? "").toLowerCase().startsWith("failed");
}
