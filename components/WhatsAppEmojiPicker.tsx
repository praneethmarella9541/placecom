"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WHATSAPP_EMOJI_CATEGORIES } from "@/lib/whatsapp-emojis";

const EMOJI_FONT =
  "[font-family:system-ui,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol','Apple_Color_Emoji','Noto_Color_Emoji']";

type Props = {
  open: boolean;
  onPick: (emoji: string) => void;
  className?: string;
};

export function WhatsAppEmojiPicker({ open, onPick, className }: Props) {
  const [tab, setTab] = useState(WHATSAPP_EMOJI_CATEGORIES[0].id);
  if (!open) return null;

  const category = WHATSAPP_EMOJI_CATEGORIES.find((c) => c.id === tab) ?? WHATSAPP_EMOJI_CATEGORIES[0];

  return (
    <div
      className={cn(
        "absolute bottom-full left-2 right-2 z-20 mb-2 flex max-h-64 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900",
        EMOJI_FONT,
        className
      )}
      role="listbox"
      aria-label="Emoji"
    >
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-zinc-200 px-1 py-1 dark:border-zinc-700">
        {WHATSAPP_EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[10px] font-medium",
              tab === c.id
                ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            onClick={() => setTab(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-8 gap-0.5 overflow-y-auto p-2 sm:grid-cols-10">
        {category.emojis.map((em, idx) => (
          <button
            key={`${tab}-${idx}-${em}`}
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => onPick(em)}
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}
