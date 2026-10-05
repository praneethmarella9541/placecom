/**
 * Size of the centered compose window, shared with the mail templates modal so
 * the two read as the same surface — a template is written at the width it
 * will be sent at, and switching between them doesn't jump.
 */
export const COMPOSE_MODAL_SIZE = {
  width: 1000,
  maxWidth: "calc(100vw - 48px)",
  height: "min(720px, calc(100vh - 96px))",
} as const;
