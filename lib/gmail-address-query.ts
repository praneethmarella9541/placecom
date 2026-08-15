/** Gmail search query matching mail either from or to a given address. */
export function gmailAddressQuery(email: string): string {
  const escaped = email.replace(/"/g, '\\"');
  return `(from:"${escaped}" OR to:"${escaped}")`;
}

/** Gmail search query matching mail either from or to *any* address at a domain — company-wide, not one person. */
export function gmailDomainQuery(domain: string): string {
  const escaped = domain.replace(/"/g, '\\"');
  return `(from:@${escaped} OR to:@${escaped})`;
}
