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

/** Actionable guidance for common Meta / Exotel delivery failures. */
export function getDeliveryFailureAdvice(deliveryStatus: string | null | undefined): string | null {
  const s = (deliveryStatus ?? "").toLowerCase();
  if (!s.startsWith("failed")) return null;

  if (
    s.includes("130472") ||
    s.includes("part of an experiment") ||
    s.includes("experiments")
  ) {
    return (
      "Meta test group: this user cannot receive marketing templates unless they message you first " +
      "(opens a 24-hour session) or you already have an active service window. Retrying the same template will not work. " +
      "Contact them by call or SMS and ask them to send you a WhatsApp message; then reply with free text or resend the template."
    );
  }

  if (
    s.includes("131049") ||
    s.includes("message limit per user") ||
    s.includes("healthy ecosystem") ||
    s.includes("frequency")
  ) {
    return (
      "Meta blocked this marketing template: this person has received too many promotional WhatsApp messages " +
      "(from any business, in a rolling window). Do not retry right away — wait at least 24 hours, then try once. " +
      "If they reply to any message, you can send free text for 24 hours. For urgent contact, use a call or SMS."
    );
  }

  if (s.includes("131021") || s.includes("not on whatsapp") || s.includes("incapable recipient")) {
    return "This number may not be registered on WhatsApp. Ask the contact to confirm their WhatsApp number.";
  }

  if (s.includes("131047") || s.includes("24 hour") || s.includes("re-engagement")) {
    return "Session expired. Send your approved template again (with both name fields), then wait for a reply before free text.";
  }

  if (s.includes("131048") || s.includes("spam rate")) {
    return "Your business line hit a spam/rate limit. Slow down outbound volume and check quality in Meta Business Manager.";
  }

  return null;
}
