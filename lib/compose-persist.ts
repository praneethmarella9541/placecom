/**
 * Module-level store for compose state that must survive route changes.
 *
 * When the user minimizes the compose dialog and navigates to another tab,
 * Next.js unmounts the inbox page and all React state is lost. This module
 * holds the minimized compose's key fields so WorkspaceChrome can render the
 * minimized bar on any route, and so the inbox page can restore state on
 * re-mount.
 *
 * Design notes:
 * - setComposePersistedState() is the ONLY mutator; the inbox page's sync
 *   effect calls it with the current state while the compose is minimized,
 *   and with `null` when it closes or expands.
 * - readComposePersistedStateForRestore() includes a short grace window so a
 *   StrictMode double-mount (dev-mode fake unmount/remount) still restores
 *   on the second mount. This grace is NOT visible to WorkspaceChrome's bar
 *   subscription — otherwise, expanding the compose and immediately
 *   navigating away would make the bar flash back briefly.
 */

export type ComposePersistedState = {
  kind: "new" | "forward" | "reply" | "replyAll";
  windowTitle: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  ccBccOpen: boolean;
  draftId: string | null;
  threadId: string | null;
  inReplyToId: string | null;
};

let _state: ComposePersistedState | null = null;
// Grace cache: survives a brief window after _state is cleared, so a
// StrictMode fake unmount/remount still finds the saved state on the
// second mount. 1500ms is well above the double-mount gap.
let _graceState: ComposePersistedState | null = null;
let _graceUntil = 0;
let _expandOnReturn = false;
let _expandGraceUntil = 0;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((l) => l());
}

export function setComposePersistedState(s: ComposePersistedState | null) {
  if (s === null && _state !== null) {
    _graceState = _state;
    _graceUntil = Date.now() + 1500;
  }
  _state = s;
  notify();
}

/**
 * Clear the store immediately with NO grace window — the user has dismissed
 * the compose entirely (e.g. closed the minimized bar from WorkspaceChrome).
 */
export function discardComposePersistedState() {
  _state = null;
  _graceState = null;
  _graceUntil = 0;
  _expandOnReturn = false;
  _expandGraceUntil = 0;
  notify();
}

/** The live store state only — used by WorkspaceChrome's subscriber. */
export function getComposePersistedState(): ComposePersistedState | null {
  return _state;
}

/**
 * Reads the store with a short grace fallback so a StrictMode double-mount
 * can restore on the second mount even though the first mount's sync effect
 * already cleared the live store. Only the inbox page should use this.
 */
export function readComposePersistedStateForRestore(): ComposePersistedState | null {
  if (_state !== null) return _state;
  if (_graceState !== null && Date.now() < _graceUntil) return _graceState;
  return null;
}

/** Signal that the inbox page should expand the compose on next mount. */
export function requestExpandComposeOnReturn() {
  _expandOnReturn = true;
}

/**
 * Returns true once and resets. Keeps the "yes" answer in a short grace
 * window so a StrictMode double-mount's second read still sees it, otherwise
 * mount 2 would restore the compose as minimized instead of expanded.
 */
export function takeExpandComposeOnReturn(): boolean {
  if (_expandOnReturn) {
    _expandOnReturn = false;
    _expandGraceUntil = Date.now() + 1500;
    return true;
  }
  if (Date.now() < _expandGraceUntil) return true;
  return false;
}

export function subscribeComposePersistedState(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
