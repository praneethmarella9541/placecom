"use client";

import { Paperclip, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type GmailComposeFooterProps = {
  onSend: () => void;
  onAttach: () => void;
  onAttachPhoto?: () => void;
  onDiscard: () => void;
  sendDisabled?: boolean;
  sending?: boolean;
  sendLabel?: string;
};

export function GmailComposeFooter({
  onSend,
  onAttach,
  onAttachPhoto,
  onDiscard,
  sendDisabled,
  sending,
  sendLabel,
}: GmailComposeFooterProps) {
  const label = sending ? "Sending…" : sendLabel ?? "Send";

  return (
    <div className="shrink-0 border-t border-[#e8eaed] bg-[#f8f9fa]">
      <div className="flex items-center gap-1 px-3 py-2">
        <div className={cn("flex shrink-0 items-center rounded-full bg-[#0b57d0]", (sendDisabled || sending) && "opacity-50 cursor-not-allowed")}>
          <button
            type="button"
            disabled={sendDisabled || sending}
            onClick={onSend}
            className="rounded-l-full px-5 py-[7px] text-[14px] font-medium text-white leading-none hover:bg-[#1765cc] disabled:pointer-events-none"
          >
            {label}
          </button>
          <button
            type="button"
            disabled={sendDisabled || sending}
            className="flex h-[34px] w-8 items-center justify-center rounded-r-full border-l border-white/25 hover:bg-[#1765cc] disabled:pointer-events-none"
            title="More send options"
            aria-label="More send options"
          >
            <ChevronDown className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          </button>
        </div>

        <FooterBtn title="Attach files" onClick={onAttach}>
          <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
        </FooterBtn>

        {onAttachPhoto && (
          <FooterBtn title="Insert photo" onClick={onAttachPhoto}>
            <PhotoIcon />
          </FooterBtn>
        )}

        <div className="flex-1" />

        <FooterBtn title="Discard draft" onClick={onDiscard}>
          <TrashIcon />
        </FooterBtn>
      </div>
    </div>
  );
}

function FooterBtn({
  title, onClick, children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#e8eaed]"
    >
      {children}
    </button>
  );
}

function PhotoIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
}

function TrashIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
}
