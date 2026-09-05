"use client";

import { createPortal } from "react-dom";

export type MassToggleDirection = "on" | "off" | "blocked";

type Props = {
  /**
   * "on" = entering mass sending, "off" = leaving it, "blocked" = a variable
   * was requested in a draft that cannot merge one yet.
   */
  direction: MassToggleDirection;
  onCancel: () => void;
  onConfirm: () => void;
};

const COPY: Record<
  MassToggleDirection,
  { title: string; body: string; confirm: string }
> = {
  on: {
    title: "Convert to mass sending?",
    body: "Cc and Bcc recipients will be cleared.",
    confirm: "Convert to Mass send",
  },
  blocked: {
    title: "You can't add a variable here",
    body:
      "To send emails with variables, you either need to send to one recipient or enter mass sending mode.",
    confirm: "Convert to Mass send",
  },
  off: {
    title: "Turn off mass sending?",
    body: "Your recipient list, subject and body will be removed, and variables can't be used.",
    confirm: "Turn off",
  },
};

/**
 * Confirmation for flipping the mass-sending switch.
 *
 * Both directions throw work away (an audience one way, typed recipients the
 * other) and the switch is a single click next to Send, so the destructive
 * step is put behind an explicit choice rather than an undo the compose
 * window does not have.
 */
export function MassSendingToggleDialog({ direction, onCancel, onConfirm }: Props) {
  if (typeof document === "undefined") return null;
  const copy = COPY[direction];

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Workspace styling, not the Gmail-chrome of the compose window it
          sits over: this is a product decision about the draft, so it uses
          the app's own surface, type and copper accent. */}
      <div
        role="alertdialog"
        aria-labelledby="mass-toggle-title"
        aria-describedby="mass-toggle-body"
        className="card w-full max-w-[400px] px-5 py-4 shadow-[var(--shadow-lg)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="mass-toggle-title"
          className="text-[15px] font-semibold text-[var(--color-text)]"
        >
          {copy.title}
        </h2>
        <p
          id="mass-toggle-body"
          className="mt-1.5 text-[13px] leading-snug text-[var(--color-text-muted)]"
        >
          {copy.body}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            No, keep it
          </button>
          <button type="button" autoFocus onClick={onConfirm} className="btn-primary-copper">
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
