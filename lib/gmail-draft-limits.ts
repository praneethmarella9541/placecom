/** Gmail's maximum inline attachment size when sending. */
export const GMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Files at or below this size are base64-encoded in the browser and sent in the
 * draft JSON body. Larger files (up to 25 MB) use chunked server staging instead.
 */
export const DRAFT_JSON_INLINE_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The one attachment rule shared by compose, mail templates and sequences: a
 * file up to Gmail's 25 MB is attached; a bigger one is uploaded to Google
 * Drive, shared "anyone with the link can view", and sent as a link in the
 * body — what Gmail itself does. Per file, with no total or count cap.
 */
export function sendsAsDriveLink(sizeBytes: number): boolean {
  return sizeBytes > GMAIL_ATTACHMENT_MAX_BYTES;
}
