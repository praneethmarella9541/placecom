/** Gmail's maximum inline attachment size when sending. */
export const GMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Files at or below this size are base64-encoded in the browser and sent in the
 * draft JSON body. Larger files (up to 25 MB) use chunked server staging instead.
 */
export const DRAFT_JSON_INLINE_MAX_BYTES = 3 * 1024 * 1024;
