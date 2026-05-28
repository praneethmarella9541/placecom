"use client";

import { useRef } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { RichTextEditor, richTextIsEmpty } from "@/components/RichTextEditor";
import { IconForward, IconReply, IconReplyAll } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

export type InlineReplyMode = "reply" | "replyAll" | null;

type GmailInlineReplyProps = {
  mode: InlineReplyMode;
  replyLabel: string;
  to: string;
  onToChange: (v: string) => void;
  cc: string;
  onCcChange: (v: string) => void;
  showCc: boolean;
  body: string;
  onBodyChange: (v: string) => void;
  suggestions: RecipientSuggestion[];
  onStartReply: () => void;
  onStartReplyAll: () => void;
  onForward: () => void;
  onDiscard: () => void;
  onSend: () => void;
  onAttach: () => void;
  sending?: boolean;
  attachmentList?: React.ReactNode;
};

/**
 * Gmail reading-pane reply UX: collapsed "Reply" stubs, expanded inline composer
 * with Send on the left and formatting toolbar above the footer.
 */
export function GmailInlineReply({
  mode,
  replyLabel,
  to,
  onToChange,
  cc,
  onCcChange,
  showCc,
  body,
  onBodyChange,
  suggestions,
  onStartReply,
  onStartReplyAll,
  onForward,
  onDiscard,
  onSend,
  onAttach,
  sending,
  attachmentList,
}: GmailInlineReplyProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (!mode) {
    return (
      <div className="space-y-2 bg-[#f6f8fc] px-4 py-4 md:px-6">
        <button
          type="button"
          onClick={onStartReply}
          className="flex w-full items-center gap-3 rounded-lg border border-transparent bg-[#f1f3f4] px-4 py-3 text-left text-[14px] text-[#5f6368] transition hover:border-[#dadce0] hover:bg-[#e8eaed] hover:shadow-sm"
        >
          <IconReply className="h-5 w-5 shrink-0 text-[#5f6368]" />
          <span>{titleCase("Reply")}</span>
        </button>
        <button
          type="button"
          onClick={onStartReplyAll}
          className="flex w-full items-center gap-3 rounded-lg border border-transparent bg-[#f1f3f4] px-4 py-3 text-left text-[14px] text-[#5f6368] transition hover:border-[#dadce0] hover:bg-[#e8eaed] hover:shadow-sm"
        >
          <IconReplyAll className="h-5 w-5 shrink-0 text-[#5f6368]" />
          <span>{titleCase("Reply all")}</span>
        </button>
        <button
          type="button"
          onClick={onForward}
          className="flex w-full items-center gap-3 rounded-lg border border-transparent bg-[#f1f3f4] px-4 py-3 text-left text-[14px] text-[#5f6368] transition hover:border-[#dadce0] hover:bg-[#e8eaed] hover:shadow-sm"
        >
          <IconForward className="h-5 w-5 shrink-0 text-[#5f6368]" />
          <span>{titleCase("Forward")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-[#e8eaed] bg-white px-4 py-3 md:px-6">
      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
        <div className="border-b border-[#f1f3f4] px-3 py-2 text-[13px] text-[#5f6368]">
          {mode === "replyAll" ? titleCase("Reply all") : titleCase("Reply")}
          <span className="text-[#202124]"> — {replyLabel}</span>
        </div>

        <div className="flex items-start gap-2 border-b border-[#f1f3f4] px-3 py-2">
          <span className="w-8 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("To")}</span>
          <div className="min-w-0 flex-1 [&_[role=group]]:min-h-[32px] [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:shadow-none">
            <RecipientField
              value={to}
              onChange={onToChange}
              suggestions={suggestions}
              placeholder=""
            />
          </div>
        </div>

        {showCc && (
          <div className="flex items-start gap-2 border-b border-[#f1f3f4] px-3 py-2">
            <span className="w-8 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Cc")}</span>
            <div className="min-w-0 flex-1 [&_[role=group]]:min-h-[32px] [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:shadow-none">
              <RecipientField
                value={cc}
                onChange={onCcChange}
                suggestions={suggestions}
                placeholder=""
              />
            </div>
          </div>
        )}

        <RichTextEditor
          value={body}
          onChange={onBodyChange}
          placeholder=""
          autoFocus
          className="min-h-[160px]"
        />

        {attachmentList}

        <div className="flex items-center gap-1 border-t border-[#f1f3f4] bg-white px-2 py-2">
          <button
            type="button"
            disabled={sending || richTextIsEmpty(body) || !to.trim()}
            onClick={onSend}
            className={cn(
              "rounded-full px-6 py-2 text-[14px] font-medium text-white shadow-sm",
              sending || richTextIsEmpty(body) || !to.trim()
                ? "cursor-not-allowed bg-[#a8c7fa]"
                : "bg-[#0b57d0] hover:bg-[#0842a0]"
            )}
          >
            {sending ? titleCase("Sending…") : titleCase("Send")}
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
            <Trash2 className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple className="hidden" aria-hidden />
    </div>
  );
}
