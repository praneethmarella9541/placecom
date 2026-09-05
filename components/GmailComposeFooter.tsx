"use client";

import { Braces, Eye, Info, Paperclip, Send } from "lucide-react";
import { cn } from "@/lib/utils";

export type GmailComposeFooterProps = {
  onSend: () => void;
  onAttach: () => void;
  onAttachPhoto?: () => void;
  onDiscard: () => void;
  sendDisabled?: boolean;
  sending?: boolean;
  sendLabel?: string;
  /** Omit to hide the toggle entirely (reply composers, thread preview). */
  massSending?: boolean;
  onMassSendingChange?: (on: boolean) => void;
  /** Disables the toggle mid-flight, e.g. once a campaign send has started. */
  massToggleDisabled?: boolean;
  /** Replaces the icon row with a Back control on the review screen. */
  backLabel?: string;
  onBack?: () => void;
  /** Secondary "Review mail" action, shown when the draft uses variables. */
  onReview?: () => void;
  reviewDisabled?: boolean;
  /**
   * Hides Send entirely. Used while a variable-bearing campaign is still in
   * the editor: the merged result has to be looked at once before it can go
   * out, so Review is the only way forward and Send appears on that screen.
   */
  sendHidden?: boolean;
  /** Inserts `{` at the caret. Omit to hide — mass sending only. */
  onInsertVariable?: () => void;
};

export function GmailComposeFooter({
  onSend,
  onAttach,
  onAttachPhoto,
  onDiscard,
  sendDisabled,
  sending,
  sendLabel,
  massSending,
  onMassSendingChange,
  massToggleDisabled,
  backLabel,
  onBack,
  onReview,
  reviewDisabled,
  sendHidden,
  onInsertVariable,
}: GmailComposeFooterProps) {
  const label = sending ? "Sending…" : sendLabel ?? "Send";
  const showMassToggle = massSending !== undefined && !!onMassSendingChange;

  return (
    <div className="shrink-0 border-t border-[#e8eaed] bg-[#f8f9fa]">
      <div className="flex items-center gap-1 px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-[7px] text-[14px] font-medium leading-none text-[#3c4043] hover:bg-[#e8eaed]"
          >
            <ChevronLeftIcon />
            {backLabel ?? "Back"}
          </button>
        ) : (
          <>
            <FooterBtn title="Attach files" onClick={onAttach}>
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
            </FooterBtn>

            {onAttachPhoto && (
              <FooterBtn title="Insert photo" onClick={onAttachPhoto}>
                <PhotoIcon />
              </FooterBtn>
            )}

            {onInsertVariable && (
              <FooterBtn title="Insert variable" onClick={onInsertVariable}>
                <Braces className="h-[18px] w-[18px]" strokeWidth={2} />
              </FooterBtn>
            )}
          </>
        )}

        <div className="flex-1" />

        {showMassToggle && (
          <div className="mr-1 flex shrink-0 items-center gap-1">
            <button
              type="button"
              role="switch"
              aria-checked={massSending}
              disabled={massToggleDisabled}
              onClick={() => onMassSendingChange?.(!massSending)}
              // Label sits inside the control so the whole thing is one hit
              // target, and both halves share a single items-center baseline.
              className="flex items-center gap-2 rounded-full px-2 py-1.5 hover:bg-[#e8eaed] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span
                className={cn(
                  "relative block h-5 w-9 shrink-0 rounded-full transition-colors",
                  massSending ? "bg-[var(--color-copper)]" : "bg-[#bdc1c6]"
                )}
              >
                {/* Explicit left + vertical centering — the knob previously
                    relied on its static position, which drifts with padding. */}
                <span
                  className={cn(
                    "absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-150",
                    massSending ? "left-[18px]" : "left-0.5"
                  )}
                />
              </span>
              <span className="text-[13px] leading-none text-[#3c4043]">Mass sending</span>
            </button>
            <span
              title="Send a personalised copy to each recipient. Use {variables} to fill in their details."
              className="flex shrink-0 items-center text-[#5f6368]"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </div>
        )}

        <FooterBtn title="Discard draft" onClick={onDiscard}>
          <TrashIcon />
        </FooterBtn>

        {onReview && (
          <button
            type="button"
            disabled={reviewDisabled || sending}
            onClick={onReview}
            className="ml-1 flex shrink-0 items-center gap-2 rounded-full border border-[#dadce0] px-5 py-[7px] text-[14px] font-medium leading-none text-[#3c4043] hover:bg-[#e8eaed] disabled:pointer-events-none disabled:opacity-50"
          >
            <Eye className="h-4 w-4" strokeWidth={2} />
            Review mail
          </button>
        )}

        {!sendHidden && (
          <button
            type="button"
            disabled={sendDisabled || sending}
            onClick={onSend}
            className={cn(
              "ml-1 flex shrink-0 items-center gap-2 rounded-full bg-[var(--color-copper)] px-6 py-[7px] text-[14px] font-medium leading-none text-white hover:bg-[var(--color-copper-hover)] disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            {!sending && <Send className="h-4 w-4" strokeWidth={2} />}
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="15 18 9 12 15 6"/></svg>;
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
