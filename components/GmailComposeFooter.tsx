"use client";

import { Paperclip, Link2, Smile, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type GmailComposeFooterProps = {
  onSend: () => void;
  onAttach: () => void;
  onDiscard: () => void;
  sendDisabled?: boolean;
  sending?: boolean;
  sendLabel?: string;
};

/**
 * Gmail-style compose footer.
 *
 * [Send ▾]  [Aa] [✎] [📎] [🔗] [😊] [Drive] [🖼] [⋮]  ···  [🗑]
 */
export function GmailComposeFooter({
  onSend,
  onAttach,
  onDiscard,
  sendDisabled,
  sending,
  sendLabel,
}: GmailComposeFooterProps) {
  const label = sending ? "Sending…" : sendLabel ?? "Send";

  return (
    <div className="shrink-0 border-t border-[#e0e0e0] bg-white">
      <div className="flex items-center gap-0.5 px-3 py-2">
        {/* Send button + dropdown arrow (split pill) */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            disabled={sendDisabled || sending}
            onClick={onSend}
            className={cn(
              "rounded-l-full px-5 py-[7px] text-[14px] font-medium text-white leading-none",
              sendDisabled || sending
                ? "cursor-not-allowed bg-[#a8c7fa]"
                : "bg-[#0b57d0] hover:bg-[#0842a0]"
            )}
          >
            {label}
          </button>
          <button
            type="button"
            disabled={sendDisabled || sending}
            className={cn(
              "flex h-[34px] w-8 items-center justify-center rounded-r-full border-l border-white/30",
              sendDisabled || sending
                ? "cursor-not-allowed bg-[#a8c7fa]"
                : "bg-[#0b57d0] hover:bg-[#0842a0]"
            )}
            title="More send options"
            aria-label="More send options"
          >
            <ChevronDown className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          </button>
        </div>

        {/* Formatting (Aa) */}
        <FooterBtn title="Formatting options" onClick={() => {}}>
          <span className="text-[13px] font-semibold leading-none tracking-tight">Aa</span>
        </FooterBtn>

        {/* Pen */}
        <FooterBtn title="More text options" onClick={() => {}}>
          <PenIcon />
        </FooterBtn>

        {/* Attach */}
        <FooterBtn title="Attach files" onClick={onAttach}>
          <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
        </FooterBtn>

        {/* Link */}
        <FooterBtn title="Insert link" onClick={() => {}}>
          <Link2 className="h-[18px] w-[18px]" strokeWidth={2} />
        </FooterBtn>

        {/* Emoji */}
        <FooterBtn title="Insert emoji" onClick={() => {}}>
          <Smile className="h-[18px] w-[18px]" strokeWidth={2} />
        </FooterBtn>

        {/* Google Drive */}
        <FooterBtn title="Insert files using Drive" onClick={() => {}}>
          <DriveIcon />
        </FooterBtn>

        {/* Photo */}
        <FooterBtn title="Insert photo" onClick={() => {}}>
          <PhotoIcon />
        </FooterBtn>

        {/* More options */}
        <FooterBtn title="More options" onClick={() => {}}>
          <MoreVertIcon />
        </FooterBtn>

        <div className="flex-1" />

        {/* Discard */}
        <FooterBtn title="Discard draft" onClick={onDiscard}>
          <TrashIcon />
        </FooterBtn>
      </div>
    </div>
  );
}

function FooterBtn({
  title,
  onClick,
  children,
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
      className="flex h-9 w-9 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#f1f3f4]"
    >
      {children}
    </button>
  );
}

function PenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 87.3 78" aria-hidden>
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 50H0c0 1.65.45 3.3 1.2 4.75z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 45.25c-.75 1.35-1.2 2.9-1.2 4.75h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.75-1.35 1.2-2.9 1.2-4.75H60L73.55 76.8z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M60 50H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.5c1.6 0 3.15-.4 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.05l-14.3-24.8A9.3 9.3 0 0 0 57.4 1.2L43.65 25l16.35 25H87.3c0-1.65-.45-3.3-1.2-4.75z" fill="#ffba00" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function MoreVertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
