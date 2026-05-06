"use client";

import { WhatsAppMessaging } from "@/components/WhatsAppMessaging";
import { titleCase } from "@/lib/title-case";

/** One-to-one WhatsApp chats; bulk send lives under Broadcasting → WhatsApp. */
export default function WhatsAppPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleCase("WhatsApp")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase("Conversations and replies — session messaging via Twilio.")}
        </p>
      </div>
      <WhatsAppMessaging embedded />
    </div>
  );
}
