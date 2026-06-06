"use client";

import { SmsMessaging } from "@/components/SmsMessaging";
import { titleCase } from "@/lib/title-case";

/** SMS conversations; bulk SMS broadcast lives under Broadcasting → SMS. */
export default function SmsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleCase("SMS")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase("Two-way SMS threads via Exotel, sent from your assigned number.")}
        </p>
      </div>
      <SmsMessaging embedded />
    </div>
  );
}
