/**
 * Gmail web UI colors — use for inbox, compose, and related mail surfaces.
 * @see https://material.io/design (Google Mail 2024)
 */
export const GMAIL_COLORS = {
  blue: "#0b57d0",
  blueHover: "#1765cc",
  blueLink: "#1a73e8",
  composePill: "#c2e7ff",
  composePillText: "#001d35",
  composeChrome: "#404040",
  bg: "#f6f8fc",
  surface: "#ffffff",
  border: "#dadce0",
  borderLight: "#e8eaed",
  borderRow: "#f1f3f4",
  text: "#202124",
  textSecondary: "#5f6368",
  textMuted: "#444746",
  textFaint: "#70757a",
  navActive: "#d3e3fd",
  rowSelected: "#c2e3fd",
  rowHover: "#f2f6fc",
  searchBg: "#eaf1fb",
  send: "#0b57d0",
} as const;

/** Gmail compose title bar — white bg, dark text */
export const GMAIL_COMPOSE_HEADER =
  "bg-white text-[#202124]";

export const GMAIL_COMPOSE_DIALOG_SHADOW =
  "shadow-[0_8px_10px_1px_rgba(60,64,67,0.14),0_3px_14px_2px_rgba(60,64,67,0.12)]";

export const GMAIL_COMPOSE_DIALOG_BORDER = "border-[#dadce0]";
