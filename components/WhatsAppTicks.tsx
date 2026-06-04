"use client";

import { cn } from "@/lib/utils";
import { formatWhatsAppDeliveryLabel, isWhatsAppDeliveryFailed } from "@/lib/whatsapp-delivery";
import { getWhatsAppTickLevel } from "@/lib/whatsapp-tick-level";

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 15" className={cn("h-[11px] w-[14px] shrink-0", className)} aria-hidden>
      <path
        fill="currentColor"
        d="M10.91 2.506a.48.48 0 0 0-.7-.055L6.44 6.986 4.9 5.482a.48.48 0 0 0-.67.69l2.02 2.128a.48.48 0 0 0 .7-.054l5.85-6.364a.48.48 0 0 0-.09-.396z"
      />
    </svg>
  );
}

/** WhatsApp-style message ticks (single / double / blue double). */
export function WhatsAppTicks({ deliveryStatus }: { deliveryStatus?: string | null }) {
  const level = getWhatsAppTickLevel(deliveryStatus);
  const title = formatWhatsAppDeliveryLabel(deliveryStatus) ?? undefined;

  if (level === "failed") {
    return (
      <span className="ml-1 inline-flex text-red-600 dark:text-red-400" title={title}>
        <span className="text-[11px] font-bold leading-none">!</span>
      </span>
    );
  }

  const color =
    level === "read"
      ? "text-[#53bdeb]"
      : level === "pending"
        ? "text-zinc-400/80"
        : "text-zinc-500/90 dark:text-zinc-400/90";

  const showDouble = level === "delivered" || level === "read";

  return (
    <span className={cn("ml-1 inline-flex items-center", color)} title={title}>
      <CheckMark />
      {showDouble ? <CheckMark className="-ml-1.5" /> : null}
    </span>
  );
}

export function showWhatsAppFailureDetail(deliveryStatus: string | null | undefined): boolean {
  return isWhatsAppDeliveryFailed(deliveryStatus);
}
