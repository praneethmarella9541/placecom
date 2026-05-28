"use client";

import { Paperclip } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type GmailComposeFooterProps = {
  onSend: () => void;
  onAttach: () => void;
  onDiscard: () => void;
  sendDisabled?: boolean;
  sending?: boolean;
  sendLabel?: string;
};

/** Gmail compose footer: Send (left), attach, spacer, discard (right). */
export function GmailComposeFooter({
  onSend,
  onAttach,
  onDiscard,
  sendDisabled,
  sending,
  sendLabel,
}: GmailComposeFooterProps) {
  const label = sending ? titleCase("Sending…") : sendLabel ?? titleCase("Send");

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-[#f1f3f4] bg-white px-2 py-2">
      <button
        type="button"
        disabled={sendDisabled || sending}
        onClick={onSend}
        className={cn(
          "rounded-full px-6 py-2 text-[14px] font-medium text-white shadow-sm",
          sendDisabled || sending
            ? "cursor-not-allowed bg-[#a8c7fa]"
            : "bg-[#0b57d0] hover:bg-[#0842a0]"
        )}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onAttach}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
        title={titleCase("Attach files")}
      >
        <Paperclip className="h-5 w-5" strokeWidth={2} />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDiscard}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
        title={titleCase("Discard draft")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}
