"use client";

import { WhatsAppMessaging } from "@/components/WhatsAppMessaging";

/** One-to-one WhatsApp chats; bulk send lives under Broadcasting → WhatsApp. */
export default function WhatsAppPage() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100dvh-56px)] min-h-0 flex-col md:-mx-6 md:-mt-6 md:h-[calc(100dvh-48px)]">
      <WhatsAppMessaging fullPage />
    </div>
  );
}
