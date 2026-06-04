"use client";

import { cn } from "@/lib/utils";
import { formatWhatsAppDeliveryLabel, isWhatsAppDeliveryFailed } from "@/lib/whatsapp-delivery";
import { getWhatsAppTickLevel } from "@/lib/whatsapp-tick-level";

/** Single grey tick (sent to WhatsApp servers). */
function MsgCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 11"
      width="12"
      height="11"
      className={cn("block shrink-0", className)}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M11.154.793a.5.5 0 0 1 .043.707L4.28 9.227a.5.5 0 0 1-.054.05l-.054.043a.5.5 0 0 1-.061.037l-.058.034a.5.5 0 0 1-.062.02l-.057.022a.5.5 0 0 1-.073.013l-.052.014a.5.5 0 0 1-.08.004l-.05.006a.5.5 0 0 1-.084 0l-.05-.006a.5.5 0 0 1-.08-.004l-.052-.014a.5.5 0 0 1-.073-.013l-.057-.022a.5.5 0 0 1-.062-.02l-.058-.034a.5.5 0 0 1-.061-.037l-.054-.043a.5.5 0 0 1-.054-.05L.793 1.5a.5.5 0 0 1 .707-.043l.707.707z"
      />
    </svg>
  );
}

/** Overlapping double tick — same icon as WhatsApp Web `msg-dblcheck`. */
function MsgDblCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 11"
      width="16"
      height="11"
      className={cn("block shrink-0", className)}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M11.078 0.684l-5.06 5.061L2.933 1.661 1.5 3.095l4.508 4.508 7.762-7.762-2.692-1.157zm-6.95 6.385L.792 3.763l-1.06 1.06 5.148 5.148 8.712-8.712-1.06-1.061-7.592 7.59z"
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
      <span className="inline-flex align-middle text-red-600 dark:text-red-400" title={title}>
        <span className="text-[11px] font-bold leading-none">!</span>
      </span>
    );
  }

  const color =
    level === "read"
      ? "text-[#53bdeb]"
      : level === "pending"
        ? "text-[#8696a0]"
        : "text-[#8696a0]";

  const showDouble = level === "delivered" || level === "read";

  return (
    <span className={cn("inline-flex shrink-0 align-middle", color)} title={title}>
      {showDouble ? <MsgDblCheck /> : <MsgCheck />}
    </span>
  );
}

export function showWhatsAppFailureDetail(deliveryStatus: string | null | undefined): boolean {
  return isWhatsAppDeliveryFailed(deliveryStatus);
}
