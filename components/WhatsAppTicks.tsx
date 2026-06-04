"use client";

import { cn } from "@/lib/utils";
import { formatWhatsAppDeliveryLabel, isWhatsAppDeliveryFailed } from "@/lib/whatsapp-delivery";
import { getWhatsAppTickLevel } from "@/lib/whatsapp-tick-level";

/** Single clean checkmark tick */
function SingleTick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 11" width="16" height="11" className={cn("block shrink-0", className)} aria-hidden fill="none">
      <polyline points="2,5.5 6,9.5 14,1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Double overlapping checkmark ticks */
function DoubleTick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 11" width="20" height="11" className={cn("block shrink-0", className)} aria-hidden fill="none">
      {/* First tick (shifted left) */}
      <polyline points="1,5.5 5,9.5 13,1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Second tick (shifted right) */}
      <polyline points="7,5.5 11,9.5 19,1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** WhatsApp-style message ticks (single grey / double grey / double blue). */
export function WhatsAppTicks({ deliveryStatus }: { deliveryStatus?: string | null }) {
  const level = getWhatsAppTickLevel(deliveryStatus);
  const title = formatWhatsAppDeliveryLabel(deliveryStatus) ?? undefined;

  if (level === "failed") {
    return (
      <span className="inline-flex items-center align-middle" title={title}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="8" y1="4" x2="8" y2="9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.75" fill="#ef4444" />
        </svg>
      </span>
    );
  }

  if (level === "pending") {
    return (
      <span className="inline-flex items-center align-middle text-[#8696a0]" title={title}>
        <svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
      </span>
    );
  }

  const showDouble = level === "delivered" || level === "read";
  const color = level === "read" ? "text-[#53bdeb]" : "text-[#8696a0]";

  return (
    <span className={cn("inline-flex shrink-0 items-center align-middle", color)} title={title}>
      {showDouble ? <DoubleTick /> : <SingleTick />}
    </span>
  );
}

export function showWhatsAppFailureDetail(deliveryStatus: string | null | undefined): boolean {
  return isWhatsAppDeliveryFailed(deliveryStatus);
}
