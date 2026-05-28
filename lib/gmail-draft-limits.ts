/** Gmail's maximum inline attachment size when sending. */
export const GMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Max size for embedding a file as base64 in a draft API request.
 * Vercel/serverless JSON bodies are ~4.5MB; base64 adds ~33% overhead.
 */
export const DRAFT_INLINE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
