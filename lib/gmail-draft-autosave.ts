/** Debounce before auto-saving a compose draft (Gmail-style pause detection). */
export const DRAFT_AUTOSAVE_DELAY_MS = 2000;

export type ComposeDraftSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
