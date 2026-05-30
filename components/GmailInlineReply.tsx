"use client";

import { IconForward, IconReply, IconReplyAll } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

/** Gmail reading-pane reply action pills */
const replyActionClass =
  "inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5 text-[14px] font-normal text-[var(--color-text-faint)] shadow-sm transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-offset)] hover:shadow-md";

type GmailInlineReplyProps = {
  onStartReply: () => void;
  onStartReplyAll: () => void;
  onForward: () => void;
};

/** Gmail reading-pane Reply / Reply all / Forward action row (opens floating compose). */
export function GmailInlineReply({
  onStartReply,
  onStartReplyAll,
  onForward,
}: GmailInlineReplyProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--gmail-border-light)] bg-[var(--color-surface)] px-4 py-4 md:px-8">
      <button type="button" onClick={onStartReply} className={replyActionClass}>
        <IconReply className="h-[18px] w-[18px] shrink-0 text-[var(--color-text-faint)]" />
        <span>{titleCase("Reply")}</span>
      </button>
      <button type="button" onClick={onStartReplyAll} className={replyActionClass}>
        <IconReplyAll className="h-[18px] w-[18px] shrink-0 text-[var(--color-text-faint)]" />
        <span>{titleCase("Reply all")}</span>
      </button>
      <button type="button" onClick={onForward} className={replyActionClass}>
        <IconForward className="h-[18px] w-[18px] shrink-0 text-[var(--color-text-faint)]" />
        <span>{titleCase("Forward")}</span>
      </button>
    </div>
  );
}
