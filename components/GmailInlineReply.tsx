"use client";

import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { RichTextEditor, richTextIsEmpty } from "@/components/RichTextEditor";
import { GmailComposeFooter } from "@/components/GmailComposeFooter";
import { GmailPendingAttachments } from "@/components/GmailPendingAttachments";
import { IconForward, IconReply, IconReplyAll } from "@/components/Icons";
import type { PendingFile } from "@/lib/gmail-compose-types";
import type { DriveUploadProgressMap } from "@/lib/upload-large-file-to-drive";
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
  files: PendingFile[];
  driveUploadProgress: DriveUploadProgressMap;
  onRemoveFile: (index: number) => void;
};

/** Gmail reading-pane reply action pills */
const replyActionClass =
  "inline-flex items-center gap-2 rounded-full border border-[#dadce0] bg-white px-5 py-2.5 text-[14px] font-normal text-[#5f6368] shadow-sm transition hover:border-[#c6c6c6] hover:bg-[#f8f9fa] hover:shadow-md";

/**
 * Gmail reading-pane reply: horizontal Reply / Reply all / Forward row,
 * then expanded inline composer with formatting toolbar and Send footer.
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
  files,
  driveUploadProgress,
  onRemoveFile,
}: GmailInlineReplyProps) {
  if (!mode) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-[#e8eaed] bg-white px-4 py-4 md:px-8">
        <button type="button" onClick={onStartReply} className={replyActionClass}>
          <IconReply className="h-[18px] w-[18px] shrink-0 text-[#5f6368]" />
          <span>{titleCase("Reply")}</span>
        </button>
        <button type="button" onClick={onStartReplyAll} className={replyActionClass}>
          <IconReplyAll className="h-[18px] w-[18px] shrink-0 text-[#5f6368]" />
          <span>{titleCase("Reply all")}</span>
        </button>
        <button type="button" onClick={onForward} className={replyActionClass}>
          <IconForward className="h-[18px] w-[18px] shrink-0 text-[#5f6368]" />
          <span>{titleCase("Forward")}</span>
        </button>
      </div>
    );
  }

  const sendDisabled = richTextIsEmpty(body) || !to.trim();

  return (
    <div className="border-t border-[#e8eaed] bg-[#f6f8fc] px-4 py-4 md:px-8">
      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
        <div className="border-b border-[#f1f3f4] px-4 py-2.5 text-[13px] text-[#5f6368]">
          {mode === "replyAll" ? titleCase("Reply all") : titleCase("Reply")}
          <span className="text-[#202124]"> — {replyLabel}</span>
        </div>

        <div className="flex items-start gap-2 border-b border-[#f1f3f4] px-3 py-2">
          <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("To")}</span>
          <div className="min-w-0 flex-1 [&_[role=group]]:min-h-[32px] [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:shadow-none">
            <RecipientField value={to} onChange={onToChange} suggestions={suggestions} placeholder="" />
          </div>
        </div>

        {showCc && (
          <div className="flex items-start gap-2 border-b border-[#f1f3f4] px-3 py-2">
            <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Cc")}</span>
            <div className="min-w-0 flex-1 [&_[role=group]]:min-h-[32px] [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:shadow-none">
              <RecipientField value={cc} onChange={onCcChange} suggestions={suggestions} placeholder="" />
            </div>
          </div>
        )}

        <RichTextEditor
          value={body}
          onChange={onBodyChange}
          placeholder=""
          autoFocus
          className={cn("min-h-[140px] [&_[contenteditable]]:min-h-[120px]")}
        />

        <GmailPendingAttachments
          files={files}
          driveUploadProgress={driveUploadProgress}
          onRemove={onRemoveFile}
        />

        <GmailComposeFooter
          onSend={onSend}
          onAttach={onAttach}
          onDiscard={onDiscard}
          sendDisabled={sendDisabled}
          sending={sending}
        />
      </div>
    </div>
  );
}
