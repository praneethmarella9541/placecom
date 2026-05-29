"use client";

/**
 * A small inline pill for a Gmail label. Color comes from Gmail when the
 * user has assigned one (`color.backgroundColor`); otherwise a per-label
 * neutral hue derived from the id keeps chips distinguishable without
 * looking random across sessions.
 */
export type LabelLike = {
  id: string;
  name: string;
  type?: "system" | "user";
  isCategory?: boolean;
  color?: { backgroundColor?: string; textColor?: string };
};

const SYSTEM_DISPLAY_NAME: Record<string, string> = {
  IMPORTANT: "Important",
  STARRED: "Starred",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
};

/** Deterministic, perceptually-distinct hue for a given label id. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function labelDisplayName(label: LabelLike): string {
  if (label.type === "user") return label.name;
  return SYSTEM_DISPLAY_NAME[label.id] ?? label.name;
}

/** Gmail-style accent colors for sidebar rows and chips without a stored color. */
export function labelAccentStyle(label: LabelLike): {
  accent: string;
  bg: string;
  fg: string;
} {
  const bg = label.color?.backgroundColor;
  const fg = label.color?.textColor;
  if (bg) {
    return { accent: bg, bg, fg: fg ?? "#fff" };
  }
  const hue = hueFor(label.id);
  return {
    accent: `hsl(${hue} 55% 42%)`,
    bg: `hsl(${hue} 82% 93%)`,
    fg: `hsl(${hue} 45% 28%)`,
  };
}

export function LabelChip({
  label,
  onRemove,
  size = "sm",
}: {
  label: LabelLike;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const bg = label.color?.backgroundColor;
  const fg = label.color?.textColor;
  const fallback = labelAccentStyle(label);
  const style: React.CSSProperties = bg
    ? { backgroundColor: bg, color: fg ?? "#fff", borderColor: bg }
    : {
        backgroundColor: fallback.bg,
        color: fallback.fg,
        borderColor: `hsl(${hueFor(label.id)} 60% 80%)`,
      };
  const pad = size === "md" ? "px-2.5 py-1 text-[12px]" : "px-1.5 py-[1px] text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium leading-tight ${pad}`}
      style={style}
      title={labelDisplayName(label)}
    >
      <span className="truncate max-w-[140px]">{labelDisplayName(label)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 -mr-0.5 opacity-70 hover:opacity-100"
          aria-label={`Remove ${labelDisplayName(label)}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
