"use client";

import { gmailAvatarColor, gmailAvatarInitial } from "@/lib/gmail-avatar";
import { cn } from "@/lib/utils";

type GmailAvatarProps = {
  /** Email or stable id used to pick avatar color. */
  seed: string;
  name: string;
  size?: number;
  className?: string;
};

/** Gmail-style colorful circular avatar with an initial. */
export function GmailAvatar({ seed, name, size = 40, className }: GmailAvatarProps) {
  const bg = gmailAvatarColor(seed);
  const initial = gmailAvatarInitial(name);
  const fontSize = size >= 40 ? 16 : size >= 32 ? 13 : 11;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
