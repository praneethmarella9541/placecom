"use client";

import { titleCase } from "@/lib/title-case";
import { WhatsAppBroadcastPanel } from "@/components/WhatsAppBroadcastPanel";

/**
 * Broadcasting — WhatsApp only.
 *
 * The mail channel (plain broadcast + mail merge) used to live here behind a
 * channel tab. It was replaced by mass sending in the inbox composer, which
 * does the same job against real contacts with a review step, so the tab bar
 * went with it rather than leaving one lone tab that can't be switched.
 */
export default function BroadcastingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="animate-fade-up flex items-end justify-between" style={{ animationDuration: "0.3s" }}>
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Broadcasting")}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-faint)]">
            {titleCase("Reach your audience on WhatsApp")}
          </p>
        </div>
      </div>

      <div className="surface-card rounded-2xl p-5 sm:p-6">
        <WhatsAppBroadcastPanel />
      </div>
    </div>
  );
}
