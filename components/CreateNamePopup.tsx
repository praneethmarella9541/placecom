"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { IconX } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

type Props = {
  /** Icon shown in the popup header, e.g. <FileText className="h-5 w-5" />. */
  icon: React.ReactNode;
  /** e.g. "New form" */
  title: string;
  /** e.g. "Form title, e.g. Campus Drive Feedback" */
  placeholder: string;
  creating: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

/**
 * Small "name this before we create it" popup shared by the Forms, Sheets and
 * Docs list pages: click Create in the page header, type a name, get routed
 * into the new file's editor.
 */
export function CreateNamePopup({ icon, title, placeholder, creating, error, onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !creating) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [creating, onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = name.trim();
    if (!t || creating) return;
    onSubmit(t);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={() => !creating && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-copper-tint)] text-[var(--color-copper)]">
            {icon}
          </div>
          <h2 className="flex-1 font-display text-[17px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase(title)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] disabled:opacity-50"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            data-testid="create-name-popup-input"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="h-12 w-full min-w-0 rounded-xl border border-transparent bg-[var(--color-surface-2)] px-4 text-[14px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
            autoComplete="off"
            disabled={creating}
          />
          {error ? (
            <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
          ) : null}
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-4 text-[14px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
            >
              {titleCase("Cancel")}
            </button>
            <button
              data-testid="create-name-popup-submit"
              type="submit"
              disabled={creating || !name.trim()}
              className={cn(
                "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-copper)] px-6 text-[14px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)]",
                (!name.trim() || creating) && "opacity-60",
              )}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {titleCase("Creating…")}
                </>
              ) : (
                titleCase("Create")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
