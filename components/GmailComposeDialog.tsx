"use client";

import { createPortal } from "react-dom";
import { useRef, useState, useCallback, useEffect } from "react";
import { Minus, Maximize, Minimize, Maximize2 } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { GmailComposeFooter } from "@/components/GmailComposeFooter";
import { IconX } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

export type GmailComposeDialogProps = {
  open: boolean;
  minimized: boolean;
  fullscreen: boolean;
  windowTitle: string;
  showSubject?: boolean;
  to: string;
  onToChange: (v: string) => void;
  cc: string;
  onCcChange: (v: string) => void;
  bcc: string;
  onBccChange: (v: string) => void;
  subject: string;
  onSubjectChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  ccBccOpen: boolean;
  onCcBccOpenChange: (open: boolean) => void;
  suggestions: RecipientSuggestion[];
  contactsHint?: string | null;
  sendDisabled?: boolean;
  onMinimize: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSend: () => void;
  onDiscard: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAttachClick: () => void;
  onFileChange: (files: FileList | null) => void;
  attachmentChips?: React.ReactNode;
};

/**
 * Gmail-style floating compose window (bottom-right dock).
 */
export function GmailComposeDialog(props: GmailComposeDialogProps) {
  const {
    open,
    minimized,
    fullscreen,
    windowTitle,
    showSubject = true,
    to,
    onToChange,
    cc,
    onCcChange,
    bcc,
    onBccChange,
    subject,
    onSubjectChange,
    body,
    onBodyChange,
    ccBccOpen,
    onCcBccOpenChange,
    suggestions,
    contactsHint,
    sendDisabled,
    onMinimize,
    onToggleFullscreen,
    onClose,
    onSend,
    onDiscard,
    fileInputRef,
    onAttachClick,
    onFileChange,
    attachmentChips,
  } = props;

  const editorRef = useRef<RichTextEditorHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Resize state — null means use CSS defaults (560px × 640px)
  const [resizeW, setResizeW] = useState<number | null>(null);
  const [resizeH, setResizeH] = useState<number | null>(null);
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, edge: "" });

  const startResize = useCallback((e: React.MouseEvent, edge: string) => {
    if (fullscreen) return;
    e.preventDefault();
    const el = (e.currentTarget as HTMLElement).closest("[data-compose-dialog]") as HTMLElement;
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: el.offsetWidth,
      startH: el.offsetHeight,
      edge,
    };
    function onMove(mv: MouseEvent) {
      const { startX, startY, startW, startH, edge: eg } = resizeRef.current;
      if (eg.includes("w")) {
        const delta = startX - mv.clientX;
        setResizeW(Math.max(420, Math.min(900, startW + delta)));
      }
      if (eg.includes("n")) {
        const delta = startY - mv.clientY;
        setResizeH(Math.max(300, Math.min(window.innerHeight - 80, startH + delta)));
      }
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [fullscreen]);

  // Reset manual size when going fullscreen
  useEffect(() => {
    if (fullscreen) { setResizeW(null); setResizeH(null); }
  }, [fullscreen]);

  if (!open || typeof document === "undefined") return null;

  const fieldGroupClass =
    "[&_[role=group]]:min-h-[36px] [&_[role=group]]:rounded-none [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:px-0 [&_[role=group]]:py-1 [&_[role=group]]:shadow-none [&_[role=group]]:focus-within:border-transparent [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-0";

  return createPortal(
    <>
      {!minimized ? (
        <button
          type="button"
          className="fixed inset-0 z-[998] bg-black/20 lg:hidden"
          aria-label={titleCase("Close compose")}
          onClick={onClose}
        />
      ) : null}

      {minimized ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-[999] flex h-11 items-center gap-1 border border-[#dadce0] bg-[#323232] px-2 text-white shadow-[0_-4px_16px_rgba(60,64,67,0.25)] lg:bottom-6 lg:left-auto lg:right-6 lg:h-10 lg:w-[560px] lg:rounded-t-lg lg:shadow-lg"
          role="dialog"
          aria-label={windowTitle}
        >
          <button
            type="button"
            onClick={onMinimize}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            title={titleCase("Expand")}
          >
            <Maximize2 className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium"
          >
            {subject.trim() || windowTitle}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            aria-label={titleCase("Close")}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          data-compose-dialog
          className={cn(
            "fixed z-[999] flex flex-col overflow-hidden bg-white text-[#202124] [color-scheme:light]",
            fullscreen
              ? "left-[2.5%] right-[2.5%] top-[2.5%] bottom-[2.5%] rounded-lg border border-[#dadce0] shadow-[0_24px_48px_rgba(60,64,67,0.3)]"
              : "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl border-x border-t border-[#dadce0] shadow-[0_-8px_24px_rgba(60,64,67,0.18)] lg:bottom-6 lg:left-auto lg:right-6 lg:rounded-t-lg lg:border lg:shadow-[0_8px_10px_1px_rgba(0,0,0,0.14),0_3px_14px_2px_rgba(0,0,0,0.12)]"
          )}
          style={!fullscreen ? {
            width: resizeW ?? 560,
            height: resizeH ?? undefined,
            maxHeight: resizeH ?? "min(640px, calc(100vh - 96px))",
          } : undefined}
          role="dialog"
          aria-modal="true"
          aria-label={windowTitle}
        >
          {/* Top resize handle */}
          {!fullscreen && (
            <div
              className="absolute top-0 left-0 right-0 h-1 cursor-n-resize z-10 hidden lg:block"
              onMouseDown={(e) => startResize(e, "n")}
            />
          )}
          {/* Left resize handle */}
          {!fullscreen && (
            <div
              className="absolute top-0 left-0 bottom-0 w-1 cursor-w-resize z-10 hidden lg:block"
              onMouseDown={(e) => startResize(e, "w")}
            />
          )}
          {/* Top-left corner resize handle */}
          {!fullscreen && (
            <div
              className="absolute top-0 left-0 h-3 w-3 cursor-nw-resize z-20 hidden lg:block"
              onMouseDown={(e) => startResize(e, "nw")}
            />
          )}
          <div className="flex shrink-0 items-center gap-1 bg-[#323232] px-2 py-1.5 text-white">
            <h2 className="min-w-0 flex-1 truncate pl-2 text-[13px] font-medium">{windowTitle}</h2>
            <button
              type="button"
              onClick={onMinimize}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              title={titleCase("Minimize")}
            >
              <Minus className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              title={fullscreen ? titleCase("Exit full screen") : titleCase("Full screen")}
            >
              {fullscreen ? (
                <Minimize className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Maximize className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
              aria-label={titleCase("Close")}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">

            {/* To row — Cc/Bcc links float right when collapsed, matching Gmail */}
            <div className="flex items-center border-b border-[#f1f3f4] px-3">
              <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                <RecipientField
                  placeholder="Recipients"
                  value={to}
                  onChange={onToChange}
                  suggestions={suggestions}
                />
              </div>
              {!ccBccOpen && (
                <div className="flex shrink-0 items-center gap-3 pl-2">
                  <button
                    type="button"
                    onClick={() => onCcBccOpenChange(true)}
                    className="text-[13px] font-medium text-[#444746] hover:text-[#0b57d0]"
                  >
                    Cc
                  </button>
                  <button
                    type="button"
                    onClick={() => onCcBccOpenChange(true)}
                    className="text-[13px] font-medium text-[#444746] hover:text-[#0b57d0]"
                  >
                    Bcc
                  </button>
                </div>
              )}
            </div>

            {ccBccOpen && (
              <>
                <div className="flex items-center border-b border-[#f1f3f4] px-3">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">Cc</span>
                  <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                    <RecipientField placeholder="Cc" value={cc} onChange={onCcChange} suggestions={suggestions} />
                  </div>
                </div>
                <div className="flex items-center border-b border-[#f1f3f4] px-3">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">Bcc</span>
                  <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                    <RecipientField placeholder="Bcc" value={bcc} onChange={onBccChange} suggestions={suggestions} />
                  </div>
                </div>
              </>
            )}

            {contactsHint ? (
              <p className="border-b border-[#f1f3f4] bg-amber-50 px-4 py-2 text-[12px] leading-snug text-amber-900">
                {contactsHint}
              </p>
            ) : null}

            {showSubject && (
              <div className="border-b border-[#f1f3f4] px-3 py-2.5">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => onSubjectChange(e.target.value)}
                  placeholder="Subject"
                  className="w-full border-0 bg-transparent text-[15px] font-medium text-[#202124] outline-none placeholder:font-normal placeholder:text-[#777]"
                />
              </div>
            )}

            <RichTextEditor
              ref={editorRef}
              value={body}
              onChange={onBodyChange}
              placeholder="Compose email"
              autoFocus
            />

            {attachmentChips}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { onFileChange(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => { onFileChange(e.target.files); e.target.value = ""; }}
          />
          <GmailComposeFooter
            onSend={onSend}
            onAttach={onAttachClick}
            onAttachPhoto={() => photoInputRef.current?.click()}
            onDiscard={onDiscard}
            sendDisabled={sendDisabled}
          />
        </div>
      )}
    </>,
    document.body
  );
}
