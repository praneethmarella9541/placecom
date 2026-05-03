export type MaxEmailsOption = "10" | "50" | "100" | "500" | "all";
export type LabelOption = "inbox" | "sent" | "all";

const MAX_KEY = "gmail_extract_max_emails";
const LABEL_KEY = "gmail_extract_label";

export function getMaxEmailsSetting(): MaxEmailsOption {
  if (typeof window === "undefined") return "50";
  const v = localStorage.getItem(MAX_KEY) as MaxEmailsOption | null;
  if (v === "10" || v === "50" || v === "100" || v === "500" || v === "all") return v;
  return "50";
}

export function setMaxEmailsSetting(v: MaxEmailsOption) {
  localStorage.setItem(MAX_KEY, v);
}

export function getLabelSetting(): LabelOption {
  if (typeof window === "undefined") return "inbox";
  const v = localStorage.getItem(LABEL_KEY) as LabelOption | null;
  if (v === "inbox" || v === "sent" || v === "all") return v;
  return "inbox";
}

export function setLabelSetting(v: LabelOption) {
  localStorage.setItem(LABEL_KEY, v);
}

export function parseMaxEmails(opt: MaxEmailsOption): number | "all" {
  if (opt === "all") return "all";
  return parseInt(opt, 10);
}
