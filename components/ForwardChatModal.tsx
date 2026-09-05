"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { isValidE164, normalizePhone } from "@/lib/phone";
import {
  buildContactNameMap,
  filterSavedContacts,
  formatPhone,
  peerInitials,
  type WaContactRow,
} from "@/lib/wa-contacts-display";
import { IconX } from "@/components/Icons";

type Props = {
  open: boolean;
  contacts: WaContactRow[];
  onClose: () => void;
  onForward: (peer: string) => void;
};

export function ForwardChatModal({ open, contacts, onClose, onForward }: Props) {
  const [phone, setPhone] = useState("");

  const contactsMap = useMemo(() => buildContactNameMap(contacts), [contacts]);
  const suggestions = useMemo(() => filterSavedContacts(contactsMap, phone), [contactsMap, phone]);
  const normalized = normalizePhone(phone.trim());
  const validPhone = phone.trim().length > 0 && isValidE164(normalized);

  function close() {
    setPhone("");
    onClose();
  }

  function pick(peer: string) {
    onForward(peer);
    setPhone("");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="forward-chat-title"
      onClick={close}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 id="forward-chat-title" className="text-[15px] font-semibold text-[var(--color-text)]">
            Forward to
          </h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-offset)]"
            onClick={close}
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <input
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2.5 text-[14px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)]"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Name or number"
            autoFocus
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {suggestions.map((item) => (
            <button
              key={item.peer_e164}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-offset)]"
              onClick={() => pick(item.peer_e164)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-copper)] text-[13px] font-bold text-white">
                {peerInitials(item.peer_e164, item.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-[var(--color-text)]">{item.name}</div>
                <div className="truncate text-[12px] text-[var(--color-text-faint)]">
                  {formatPhone(item.peer_e164)}
                </div>
              </div>
            </button>
          ))}
          {!suggestions.length ? (
            <p className="px-2 py-6 text-center text-[13px] text-[var(--color-text-faint)]">
              {phone.trim() ? "No matching contacts" : "Search contacts or enter a number"}
            </p>
          ) : null}
        </div>

        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            disabled={!validPhone}
            className={cn(
              "w-full rounded-xl bg-[var(--color-copper)] py-3 text-[14px] font-semibold text-white transition-[opacity,background-color] hover:bg-[var(--color-copper-hover)]",
              !validPhone && "cursor-not-allowed opacity-45"
            )}
            onClick={() => pick(normalized)}
          >
            Forward
          </button>
        </div>
      </div>
    </div>
  );
}
