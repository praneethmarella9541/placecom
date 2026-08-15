"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WhatsAppMessaging } from "@/components/WhatsAppMessaging";
import { TeamWhatsAppViewer } from "@/components/TeamWhatsAppViewer";
import { useMeMailbox } from "@/lib/use-me-mailbox";

function WhatsAppPageContent() {
  const searchParams = useSearchParams();
  const initialPeer = searchParams.get("peer");
  const { me } = useMeMailbox();
  const isAdmin = me?.role === "admin";
  const [tab, setTab] = useState<"mine" | "team">("mine");

  if (!isAdmin) {
    return <WhatsAppMessaging fullPage initialPeer={initialPeer} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <button
          onClick={() => setTab("mine")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tab === "mine"
              ? "bg-[var(--color-copper)] text-[var(--color-surface)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
          }`}
        >
          My Inbox
        </button>
        <button
          onClick={() => setTab("team")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tab === "team"
              ? "bg-[var(--color-copper)] text-[var(--color-surface)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
          }`}
        >
          Team (read-only)
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "mine" ? (
          <WhatsAppMessaging fullPage initialPeer={initialPeer} />
        ) : (
          <TeamWhatsAppViewer />
        )}
      </div>
    </div>
  );
}

/** One-to-one WhatsApp chats; bulk send lives under Broadcasting → WhatsApp. */
export default function WhatsAppPage() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100dvh-56px)] min-h-0 flex-col md:-mx-6 md:-mt-6 md:h-[calc(100dvh-48px)]">
      <Suspense fallback={null}>
        <WhatsAppPageContent />
      </Suspense>
    </div>
  );
}
