/**
 * Title case for UI strings: capitalize major words; keep minor words
 * (articles, conjunctions, short prepositions) lowercase unless first or
 * last word in the phrase. Hyphenated and slash-separated segments follow
 * the same first/last rules within their token.
 */
const SMALL = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "el",
  "for",
  "from",
  "if",
  "in",
  "into",
  "no",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "via",
  "vs",
  "vs.",
  "is",
  "it",
  "its",
  "with",
  "without",
  "over",
  "about",
  "than",
  "then",
  "that",
  "near",
  "like",
  "upon",
  "within",
]);

const SPECIAL: Record<string, string> = {
  gmail: "Gmail",
  google: "Google",
  csv: "CSV",
  api: "API",
  crm: "CRM",
  jd: "JD",
  jds: "JDs",
  sql: "SQL",
  ui: "UI",
  url: "URL",
  oauth: "OAuth",
  ios: "iOS",
  id: "ID",
  mgt: "Mgt",
  ai: "AI",
  linkedin: "LinkedIn",
};

function formatChunk(
  chunk: string,
  isAbsoluteFirst: boolean,
  isAbsoluteLast: boolean
): string {
  const m = chunk.match(/^([^A-Za-z0-9]*)([A-Za-z0-9']+)([^A-Za-z0-9]*)$/);
  if (!m) return chunk;
  const [, pre, core, suf] = m;
  const lw = core.toLowerCase();
  let mid: string;
  if (!isAbsoluteFirst && !isAbsoluteLast && SMALL.has(lw)) {
    mid = lw;
  } else if (SPECIAL[lw]) {
    mid = SPECIAL[lw];
  } else if (/^[A-Z]{2,5}$/.test(core)) {
    mid = core;
  } else {
    mid = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
  }
  return pre + mid + suf;
}

/**
 * Apply title case to a phrase (space-separated tokens; `/` and `-` preserved).
 */
export function titleCase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return input;
  const words = trimmed.split(/\s+/);
  const n = words.length;

  return words
    .map((w, wi) =>
      w
        .split("/")
        .map((seg, si, segs) =>
          seg
            .split("-")
            .map((hy, hi, hys) => {
              const isAbsoluteFirst = wi === 0 && si === 0 && hi === 0;
              const isAbsoluteLast =
                wi === n - 1 && si === segs.length - 1 && hi === hys.length - 1;
              return formatChunk(hy, isAbsoluteFirst, isAbsoluteLast);
            })
            .join("-")
        )
        .join("/")
    )
    .join(" ");
}
