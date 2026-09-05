const SUBDOMAIN_PREFIXES = ["mail.", "www.", "smtp.", "email.", "e."];

// Domains whose second-level label isn't the company name (e.g. "acme.co.in" -> "acme", not "co").
const COMPOUND_TLDS = new Set(["co.in", "com.au", "co.uk", "com.br", "co.nz", "co.za"]);

/** Best-effort, display-only company name guess from an email domain (e.g. "exotel.com" -> "Exotel"). */
export function guessCompanyNameFromDomain(domain: string): string {
  let d = domain.toLowerCase().trim();
  for (const prefix of SUBDOMAIN_PREFIXES) {
    if (d.startsWith(prefix)) {
      d = d.slice(prefix.length);
      break;
    }
  }

  const parts = d.split(".");
  let label = parts[0] || d;

  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join(".");
    if (COMPOUND_TLDS.has(lastTwo)) {
      label = parts[parts.length - 3] || label;
    }
  }

  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
