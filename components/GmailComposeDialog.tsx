"use client";

import { createPortal } from "react-dom";
import { Paperclip, Minus, Maximize, Minimize, Maximize2, Loader2 } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { RichTextEditor } from "@/components/RichTextEditor";
import { IconX } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

export type GmailComposeDialogProps = {
  open: boolean;
  minimized: boolean;
  fullscreen: boolean;
  /** Window title: New Message, Reply, Reply All, Forward */
  windowTitle: string;
  /** Hide subject row for replies (Gmail keeps it but read-only feel — we show Re: subject) */
  showSubject?: boolean;
  to: string;
  onToChange: (v: string) => void;
  cc: string;
  onCcChange: (v: string) => void;
  bcc: string;
  onBccChange: (v: string) => void;
  subject: string;
  onSubjectChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  ccBccOpen: boolean;
  onCcBccOpenChange: (open: boolean) => void;
  suggestions: RecipientSuggestion[];
  contactsHint?: string | null;
  sendDisabled?: boolean;
  onMinimize: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSend: () => void;
  onDiscard: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAttachClick: () => void;
  onFileChange: (files: FileList | null) => void;
  attachmentChips?: React.ReactNode;
};

/**
 * Gmail-style floating compose / reply / forward window (bottom-right dock).
 */
export function GmailComposeDialog(props: GmailComposeDialogProps) {
  const {
    open,
    minimized,
    fullscreen,
    windowTitle,
    showSubject = true,
    to,
    onToChange,
    cc,
    onCcChange,
    bcc,
    onBccChange,
    subject,
    onSubjectChange,
    body,
    onBodyChange,
    ccBccOpen,
    onCcBccOpenChange,
    suggestions,
    contactsHint,
    sendDisabled,
    onMinimize,
    onToggleFullscreen,
    onClose,
    onSend,
    onDiscard,
    fileInputRef,
    onAttachClick,
    onFileChange,
    attachmentChips,
  } = props;

  if (!open || typeof document === "undefined") return null;

  const fieldGroupClass =
    "[&_[role=group]]:min-h-[36px] [&_[role=group]]:rounded-none [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:px-0 [&_[role=group]]:py-1 [&_[role=group]]:shadow-none [&_[role=group]]:focus-within:border-transparent [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-0";

  return createPortal(
    <>
      {!minimized ? (
        <button
          type="button"
          className="fixed inset-0 z-[998] bg-black/20 lg:hidden"
          aria-label={titleCase("Close compose")}
          onClick={onClose}
        />
      ) : null}

      {minimized ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-[999] flex h-11 items-center gap-1 border border-[#dadce0] bg-[#323232] px-2 text-white shadow-[0_-4px_16px_rgba(60,64,67,0.25)] lg:bottom-6 lg:left-auto lg:right-6 lg:h-10 lg:w-[528px] lg:rounded-lg lg:shadow-lg"
          role="dialog"
          aria-label={windowTitle}
        >
          <button
            type="button"
            onClick={onMinimize}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            title={titleCase("Expand")}
          >
            <Maximize2 className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium"
          >
            {subject.trim() || windowTitle}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            aria-label={titleCase("Close")}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "fixed z-[999] flex flex-col overflow-hidden bg-white text-[#202124] [color-scheme:light]",
            fullscreen
              ? "left-[2.5%] right-[2.5%] top-[2.5%] bottom-[2.5%] rounded-lg border border-[#dadce0] shadow-[0_24px_48px_rgba(60,64,67,0.3)]"
              : "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl border-x border-t border-[#dadce0] shadow-[0_-8px_24px_rgba(60,64,67,0.18)] lg:bottom-6 lg:left-auto lg:right-6 lg:max-h-[min(620px,calc(100vh-96px))] lg:w-[528px] lg:rounded-t-lg lg:border lg:shadow-[0_8px_10px_1px_rgba(0,0,0,0.14),0_3px_14px_2px_rgba(0,0,0,0.12)]"
          )}
          role="dialog"
          aria-modal="true"
          aria-label={windowTitle}
        >
          <div className="flex shrink-0 items-center gap-1 bg-[#404040] px-2 py-1.5 text-white">
            <h2 className="min-w-0 flex-1 truncate pl-2 text-[13px] font-medium">{windowTitle}</h2>
            <button
              type="button"
              onClick={onMinimize}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              title={titleCase("Minimize")}
            >
              <Minus className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              title={fullscreen ? titleCase("Exit full screen") : titleCase("Full screen")}
            >
              {fullscreen ? (
                <Minimize className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Maximize className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              aria-label={titleCase("Close")}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
            <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
              <span className="w-9 shrink-0 pt-2 text-right text-[13px] leading-none text-[#5f6368]">
                {titleCase("To")}
              </span>
              <div className={cn("min-w-0 flex-1", fieldGroupClass)}>
                <RecipientField
                  placeholder={titleCase("Recipients")}
                  value={to}
                  onChange={onToChange}
                  suggestions={suggestions}
                />
              </div>
            </div>

            {!ccBccOpen ? (
              <div className="flex items-center gap-3 border-b border-[#f1f3f4] px-3 py-1.5">
                <span className="w-9 shrink-0" aria-hidden />
                <button
                  type="button"
                  onClick={() => onCcBccOpenChange(true)}
                  className="text-[13px] font-medium text-[#1a73e8] hover:underline"
                >
                  {titleCase("Cc")}
                </button>
                <button
                  type="button"
                  onClick={() => onCcBccOpenChange(true)}
                  className="text-[13px] font-medium text-[#1a73e8] hover:underline"
                >
                  {titleCase("Bcc")}
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
                  <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Cc")}</span>
                  <div className={cn("min-w-0 flex-1", fieldGroupClass)}>
                    <RecipientField
                      placeholder={titleCase("Cc")}
                      value={cc}
                      onChange={onCcChange}
                      suggestions={suggestions}
                    />
                  </div>
                </div>
                <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
                  <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Bcc")}</span>
                  <div className={cn("min-w-0 flex-1", fieldGroupClass)}>
                    <RecipientField
                      placeholder={titleCase("Bcc")}
                      value={bcc}
                      onChange={onBccChange}
                      suggestions={suggestions}
                    />
                  </div>
                </div>
              </>
            )}

            {contactsHint ? (
              <p className="border-b border-[#f1f3f4] bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
                {contactsHint}
              </p>
            ) : null}

            {showSubject ? (
              <div className="flex items-center gap-3 border-b border-[#f1f3f4] px-3 py-2">
                <span className="w-9 shrink-0 text-right text-[13px] text-[#5f6368]">{titleCase("Subject")}</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => onSubjectChange(e.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#202124] outline-none"
                />
              </div>
            ) : null}

            <RichTextEditor
              value={body}
              onChange={onBodyChange}
              placeholder={titleCase("Compose email")}
              autoFocus
            />

            {attachmentChips}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#f1f3f4] bg-white px-3 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFileChange(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={onAttachClick}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              title={titleCase("Attach files")}
            >
              <Paperclip className="h-5 w-5" strokeWidth={2} />
            </button>
            <div className="flex flex-1 items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDiscard}
                className="rounded-full px-4 py-2 text-[13px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                {titleCase("Discard")}
              </button>
              <button
                type="button"
                disabled={sendDisabled}
                onClick={onSend}
                className="rounded-full bg-[#1a73e8] px-6 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#1557b0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {titleCase("Send")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
