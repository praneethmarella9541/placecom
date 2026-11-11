import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (cron bearer secret, etc.).
 *
 * Both values are hashed with SHA-256 first, so the comparison always runs over two 32-byte
 * digests: it takes the same time whatever the input lengths or contents, and a wrong guess
 * reveals nothing about how many leading characters matched (CASA 4.1.3).
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
