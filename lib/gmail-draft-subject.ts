/** Display-only label for empty subjects in lists (never written into draft MIME). */
export const EMPTY_SUBJECT_LABEL = "(no subject)";

/** Gmail drafts we saved earlier may have this placeholder in the Subject header. */
export function isPlaceholderDraftSubject(subject: string): boolean {
  const t = (subject || "").trim().toLowerCase();
  return (
    t === "" ||
    t === "(no subject)" ||
    t === "(no subject )" ||
    t === "no subject"
  );
}

/** Subject line for draft MIME — leave empty when the user did not set one. */
export function draftSubjectForMime(subject: string): string {
  return isPlaceholderDraftSubject(subject) ? "" : (subject || "").trim();
}

/** Subject for the compose field when opening a draft. */
export function draftSubjectForCompose(subject: string): string {
  return draftSubjectForMime(subject);
}

/** Subject shown in the drafts thread list. */
export function draftSubjectForDisplay(subject: string): string {
  const s = draftSubjectForCompose(subject);
  return s || EMPTY_SUBJECT_LABEL;
}
