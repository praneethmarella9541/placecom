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

const replyActionClass =
  "inline-flex items-center gap-2 rounded-full border border-[#a8c7fa] bg-[#e8f0fe] px-5 py-2.5 text-[14px] font-medium text-[#1967d2] shadow-sm transition hover:border-[#8ab4f8] hover:bg-[#d2e3fc] hover:shadow-md";
const replyAllActionClass =
  "inline-flex items-center gap-2 rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-5 py-2.5 text-[14px] font-medium text-[#4338ca] shadow-sm transition hover:border-[#a5b4fc] hover:bg-[#e0e7ff] hover:shadow-md";
const forwardActionClass =
  "inline-flex items-center gap-2 rounded-full border border-[#81c995] bg-[#e6f4ea] px-5 py-2.5 text-[14px] font-medium text-[#137333] shadow-sm transition hover:border-[#5bb974] hover:bg-[#ceead6] hover:shadow-md";

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
      <div className="flex flex-wrap items-center gap-2 border-t border-[#c7d2fe] bg-gradient-to-b from-[#f8faff] to-white px-4 py-4 md:px-8">
        <button type="button" onClick={onStartReply} className={replyActionClass}>
          <IconReply className="h-[18px] w-[18px] shrink-0 text-[#1967d2]" />
          <span>{titleCase("Reply")}</span>
        </button>
        <button type="button" onClick={onStartReplyAll} className={replyAllActionClass}>
          <IconReplyAll className="h-[18px] w-[18px] shrink-0 text-[#4338ca]" />
          <span>{titleCase("Reply all")}</span>
        </button>
        <button type="button" onClick={onForward} className={forwardActionClass}>
          <IconForward className="h-[18px] w-[18px] shrink-0 text-[#137333]" />
          <span>{titleCase("Forward")}</span>
        </button>
      </div>
    );
  }

  const sendDisabled = richTextIsEmpty(body) || !to.trim();

  const headerAccent =
    mode === "replyAll"
      ? "border-l-[#6366f1] from-[#eef2ff] to-[#f5f3ff] text-[#4338ca]"
      : "border-l-[#1a73e8] from-[#e8f0fe] to-[#f0f4ff] text-[#1967d2]";

  return (
    <div className="border-t border-[#c7d2fe] bg-gradient-to-b from-[#eef2ff]/40 to-white px-4 py-4 md:px-8">
      <div className="overflow-hidden rounded-xl border border-[#a5b4fc] bg-white shadow-md shadow-indigo-100/60">
        <div
          className={cn(
            "border-b border-[#e0e7ff] border-l-4 px-4 py-2.5 text-[13px] font-medium bg-gradient-to-r",
            headerAccent
          )}
        >
          {mode === "replyAll" ? titleCase("Reply all") : titleCase("Reply")}
          <span className="font-normal text-[#202124]"> — {replyLabel}</span>
        </div>

        <div className="flex items-start gap-2 border-b border-[#e0e7ff] bg-[#fafbff] px-3 py-2">
          <span className="w-9 shrink-0 pt-2 text-right text-[13px] font-medium text-[#4f46e5]">{titleCase("To")}</span>
          <div className="min-w-0 flex-1 [&_[role=group]]:min-h-[32px] [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:shadow-none">
            <RecipientField value={to} onChange={onToChange} suggestions={suggestions} placeholder="" />
          </div>
        </div>

        {showCc && (
          <div className="flex items-start gap-2 border-b border-[#e0e7ff] bg-[#fafbff] px-3 py-2">
            <span className="w-9 shrink-0 pt-2 text-right text-[13px] font-medium text-[#4f46e5]">{titleCase("Cc")}</span>
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
