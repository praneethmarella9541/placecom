"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WHATSAPP_EMOJI_CATEGORIES } from "@/lib/whatsapp-emojis";

const EMOJI_FONT =
  "[font-family:system-ui,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol','Apple_Color_Emoji','Noto_Color_Emoji']";

type Props = {
  open: boolean;
  onPick: (emoji: string) => void;
  /** Anchor element — picker positions itself above this */
  anchorRef?: React.RefObject<HTMLElement>;
  className?: string;
};

export function WhatsAppEmojiPicker({ open, onPick, anchorRef, className }: Props) {
  const [tab, setTab] = useState(WHATSAPP_EMOJI_CATEGORIES[0].id);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Position above the anchor using fixed coords so it's never clipped
  useEffect(() => {
    if (!open || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerW = 320;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - pickerW - 8));
    const bottom = window.innerHeight - rect.top + 8;
    setPos({ bottom, left });
  }, [open, anchorRef]);

  if (!open) return null;

  const category = WHATSAPP_EMOJI_CATEGORIES.find((c) => c.id === tab) ?? WHATSAPP_EMOJI_CATEGORIES[0];

  return (
    <div
      ref={pickerRef}
      className={cn(
        "fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
        EMOJI_FONT,
        className
      )}
      style={
        pos
          ? { bottom: pos.bottom, left: pos.left, width: 320, height: 340 }
          : { bottom: "5rem", left: "1rem", width: 320, height: 340 }
      }
      role="listbox"
      aria-label="Emoji picker"
    >
      {/* Category tabs */}
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--color-border)] px-1.5 py-1.5">
        {WHATSAPP_EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn(
              "shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
              tab === c.id
                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
            )}
            onClick={() => setTab(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="scrollbar-thin grid flex-1 grid-cols-8 content-start gap-0.5 overflow-y-auto p-2">
        {category.emojis.map((em, idx) => (
          <button
            key={`${tab}-${idx}-${em}`}
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none transition-colors hover:bg-[var(--color-surface-offset)]"
            onClick={() => onPick(em)}
            title={em}
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}
