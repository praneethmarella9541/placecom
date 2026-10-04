"use client";

import { createPortal } from "react-dom";

type Props = {
  /**
   * What is wrong, in the reader's terms. Several different problems route
   * through this dialog, so the heading is the caller's to supply — a shared
   * "Error" made every one of them look like the same unexplained failure.
   */
  title?: string;
  message: string;
  onDismiss: () => void;
};

/** Gmail-style compose validation error (invalid recipient, etc.). */
export function GmailComposeErrorDialog({ title, message, onDismiss }: Props) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="compose-error-title"
        aria-describedby="compose-error-body"
        className="w-full max-w-[480px] rounded-lg bg-white px-6 py-5 shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="compose-error-title" className="text-[22px] font-normal text-[#202124]">
          {title ?? "This draft can't be sent yet"}
        </h2>
        <p id="compose-error-body" className="mt-4 text-[14px] leading-relaxed text-[#202124]">
          {message}
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full bg-[#0b57d0] px-6 py-2 text-[14px] font-medium text-white hover:bg-[#0842a0]"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
