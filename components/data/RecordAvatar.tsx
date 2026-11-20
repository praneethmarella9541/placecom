import { gmailAvatarColor, gmailAvatarInitials } from "@/lib/gmail-avatar";
import { cn } from "@/lib/utils";

/** Coloured initials for a record. Same palette as the mail avatars, with no photo lookup per row. */
export function RecordAvatar({ name, seed, size = 24, square = false, className }: { name: string; seed: string; size?: number; square?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center font-semibold text-white", square ? "rounded-md" : "rounded-full", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), backgroundColor: gmailAvatarColor(seed || name) }}
    >
      {gmailAvatarInitials(name || "?")}
    </span>
  );
}
