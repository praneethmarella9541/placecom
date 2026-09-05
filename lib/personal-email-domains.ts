/**
 * Consumer / free webmail domains — a pile of unrelated individuals, not an
 * organisation. The Companies view keeps them grouped per-domain (so you can
 * still browse "everyone I know on Gmail") but labels the card
 * "<Provider> (personal)" so e.g. gmail.com doesn't masquerade as the company
 * "Google". Display-only: nothing about bucketing or the People list changes.
 */
const PERSONAL_EMAIL_PROVIDERS: Record<string, string> = {
  // Google
  "gmail.com": "Gmail",
  "googlemail.com": "Gmail",
  // Microsoft
  "outlook.com": "Outlook",
  "outlook.in": "Outlook",
  "hotmail.com": "Outlook",
  "hotmail.co.uk": "Outlook",
  "hotmail.fr": "Outlook",
  "hotmail.de": "Outlook",
  "hotmail.it": "Outlook",
  "hotmail.es": "Outlook",
  "live.com": "Outlook",
  "live.co.uk": "Outlook",
  "live.in": "Outlook",
  "msn.com": "Outlook",
  // Yahoo
  "yahoo.com": "Yahoo",
  "yahoo.co.in": "Yahoo",
  "yahoo.co.uk": "Yahoo",
  "yahoo.ca": "Yahoo",
  "yahoo.com.au": "Yahoo",
  "yahoo.fr": "Yahoo",
  "yahoo.de": "Yahoo",
  "ymail.com": "Yahoo",
  "rocketmail.com": "Yahoo",
  // Apple
  "icloud.com": "iCloud",
  "me.com": "iCloud",
  "mac.com": "iCloud",
  // Proton
  "proton.me": "Proton",
  "protonmail.com": "Proton",
  "pm.me": "Proton",
  // Other global webmail
  "aol.com": "AOL",
  "gmx.com": "GMX",
  "gmx.de": "GMX",
  "gmx.net": "GMX",
  "mail.com": "Mail.com",
  "zoho.com": "Zoho",
  "zohomail.com": "Zoho",
  "yandex.com": "Yandex",
  "yandex.ru": "Yandex",
  "fastmail.com": "Fastmail",
  "fastmail.fm": "Fastmail",
  "hey.com": "HEY",
  "tutanota.com": "Tuta",
  "tuta.io": "Tuta",
  "hushmail.com": "Hushmail",
  // India
  "rediffmail.com": "Rediffmail",
  "rediff.com": "Rediffmail",
  // China
  "qq.com": "QQ Mail",
  "foxmail.com": "QQ Mail",
  "163.com": "NetEase",
  "126.com": "NetEase",
  "sina.com": "Sina",
};

function normalize(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  return d || null;
}

/** Friendly provider name for a consumer webmail domain (e.g. "Gmail"), or null for a real org domain. */
export function personalEmailProvider(domain: string | null | undefined): string | null {
  const d = normalize(domain);
  return d ? (PERSONAL_EMAIL_PROVIDERS[d] ?? null) : null;
}

export function isPersonalEmailDomain(domain: string | null | undefined): boolean {
  return personalEmailProvider(domain) !== null;
}

/** Company-card label for a consumer webmail domain (e.g. "Gmail (personal)"), or null for a real org domain. */
export function personalEmailCompanyLabel(domain: string | null | undefined): string | null {
  const provider = personalEmailProvider(domain);
  return provider ? `${provider} (personal)` : null;
}
