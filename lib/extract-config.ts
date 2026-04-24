/**
 * Max emails per `/api/extract` POST (batched dashboard flow).
 * Larger ⇒ fewer HTTP round trips (important for tens of thousands of messages).
 *
 * Set `NEXT_PUBLIC_EXTRACT_HTTP_BATCH_SIZE` so the dashboard matches the API
 * (server also reads `EXTRACT_HTTP_BATCH_SIZE` if set on the host).
 */
const MIN = 5;
const MAX = 80;

export function getExtractHttpBatchSize(): number {
  const raw = (
    process.env.EXTRACT_HTTP_BATCH_SIZE ||
    process.env.NEXT_PUBLIC_EXTRACT_HTTP_BATCH_SIZE ||
    ""
  )
    .trim();
  const n = raw ? parseInt(raw, 10) : 50;
  if (!Number.isFinite(n)) return 50;
  return Math.min(MAX, Math.max(MIN, Math.floor(n)));
}
