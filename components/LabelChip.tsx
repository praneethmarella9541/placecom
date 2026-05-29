"use client";

/**
 * A small inline pill for a Gmail label. Colors come from a curated palette
 * assigned without overlap within the user's label set (Gmail custom colors
 * are kept when unique).
 */
export type LabelLike = {
  id: string;
  name: string;
  type?: "system" | "user";
  isCategory?: boolean;
  color?: { backgroundColor?: string; textColor?: string };
};

export type LabelAccent = {
  accent: string;
  bg: string;
  fg: string;
  border: string;
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

/** Gmail-inspired palette — each entry is visually distinct from the others. */
const LABEL_PALETTE: LabelAccent[] = [
  { bg: "#e8f0fe", fg: "#174ea6", accent: "#1a73e8", border: "#aecbfa" },
  { bg: "#e6f4ea", fg: "#137333", accent: "#34a853", border: "#a8dab5" },
  { bg: "#fce8e6", fg: "#c5221f", accent: "#ea4335", border: "#f5c6c2" },
  { bg: "#fef7e0", fg: "#b06000", accent: "#f9ab00", border: "#fde293" },
  { bg: "#f3e8fd", fg: "#7627bb", accent: "#a142f4", border: "#d7aefb" },
  { bg: "#e0f7fa", fg: "#006064", accent: "#0097a7", border: "#80deea" },
  { bg: "#fce4ec", fg: "#880e4f", accent: "#e91e63", border: "#f8bbd0" },
  { bg: "#fff3e0", fg: "#e65100", accent: "#ff6d00", border: "#ffcc80" },
  { bg: "#e8eaf6", fg: "#283593", accent: "#3f51b5", border: "#9fa8da" },
  { bg: "#e0f2f1", fg: "#00695c", accent: "#00897b", border: "#80cbc4" },
  { bg: "#f1f8e9", fg: "#33691e", accent: "#689f38", border: "#c5e1a5" },
  { bg: "#ede7f6", fg: "#4527a0", accent: "#673ab7", border: "#b39ddb" },
  { bg: "#fff8e1", fg: "#ff6f00", accent: "#ffa000", border: "#ffe082" },
  { bg: "#e1f5fe", fg: "#01579b", accent: "#0288d1", border: "#81d4fa" },
  { bg: "#f9fbe7", fg: "#827717", accent: "#afb42b", border: "#dce775" },
  { bg: "#ffebee", fg: "#b71c1c", accent: "#d32f2f", border: "#ef9a9a" },
  { bg: "#e8f5e9", fg: "#1b5e20", accent: "#388e3c", border: "#a5d6a7" },
  { bg: "#f3e5f5", fg: "#6a1b9a", accent: "#8e24aa", border: "#ce93d8" },
  { bg: "#fffde7", fg: "#f57f17", accent: "#fbc02d", border: "#fff59d" },
  { bg: "#e0f7fa", fg: "#00838f", accent: "#00acc1", border: "#4dd0e1" },
  { bg: "#fafafa", fg: "#424242", accent: "#757575", border: "#e0e0e0" },
  { bg: "#efebe9", fg: "#4e342e", accent: "#795548", border: "#bcaaa4" },
  { bg: "#eceff1", fg: "#37474f", accent: "#607d8b", border: "#b0bec5" },
  { bg: "#e8eaf6", fg: "#1a237e", accent: "#3949ab", border: "#9fa8da" },
];

function hashLabelId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function accentFromHue(hue: number): LabelAccent {
  return {
    accent: `hsl(${hue} 55% 42%)`,
    bg: `hsl(${hue} 82% 93%)`,
    fg: `hsl(${hue} 45% 28%)`,
    border: `hsl(${hue} 60% 80%)`,
  };
}

/**
 * Assign each user label a distinct palette color. Gmail custom colors are
 * preserved when no other label already uses the same background.
 */
export function buildLabelColorMap(labels: LabelLike[]): Map<string, LabelAccent> {
  const sorted = labels
    .filter((l) => l.type === "user" || l.type === undefined)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const map = new Map<string, LabelAccent>();
  const usedBg = new Set<string>();
  const usedPaletteIndices = new Set<number>();

  for (const label of sorted) {
    const bg = label.color?.backgroundColor?.trim().toLowerCase();
    if (bg && !usedBg.has(bg)) {
      usedBg.add(bg);
      map.set(label.id, {
        accent: bg,
        bg,
        fg: label.color?.textColor?.trim() || "#fff",
        border: bg,
      });
    }
  }

  for (const label of sorted) {
    if (map.has(label.id)) continue;

    let idx = hashLabelId(label.id) % LABEL_PALETTE.length;
    let spin = 0;
    while (usedPaletteIndices.has(idx) && spin < LABEL_PALETTE.length) {
      idx = (idx + 1) % LABEL_PALETTE.length;
      spin++;
    }

    if (spin < LABEL_PALETTE.length) {
      usedPaletteIndices.add(idx);
      map.set(label.id, LABEL_PALETTE[idx]);
    } else {
      // More labels than palette slots — golden-angle hues stay visually separated.
      const hue = (hashLabelId(label.id) * 137.508) % 360;
      map.set(label.id, accentFromHue(hue));
    }
  }

  return map;
}

export function labelDisplayName(label: LabelLike): string {
  if (label.type === "user") return label.name;
  return SYSTEM_DISPLAY_NAME[label.id] ?? label.name;
}

/** Resolve accent colors for one label (prefer map entry from buildLabelColorMap). */
export function labelAccentStyle(
  label: LabelLike,
  accent?: LabelAccent
): LabelAccent {
  if (accent) return accent;
  return LABEL_PALETTE[hashLabelId(label.id) % LABEL_PALETTE.length];
}

export function LabelChip({
  label,
  accent,
  onRemove,
  size = "sm",
}: {
  label: LabelLike;
  /** Pass from buildLabelColorMap for consistent, non-overlapping colors. */
  accent?: LabelAccent;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const colors = accent ?? labelAccentStyle(label);
  const pad = size === "md" ? "px-2.5 py-1 text-[12px]" : "px-1.5 py-[1px] text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium leading-tight ${pad}`}
      style={{
        backgroundColor: colors.bg,
        color: colors.fg,
        borderColor: colors.border,
      }}
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
