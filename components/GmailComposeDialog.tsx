"use client";

import { createPortal } from "react-dom";
import { useRef, useState, useCallback, useEffect } from "react";
import { Minus, Maximize, Minimize, Maximize2, Eye } from "lucide-react";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { ComposeDraftSaveIndicator } from "@/components/ComposeDraftSaveIndicator";
import { GmailComposeFooter } from "@/components/GmailComposeFooter";
import { GmailComposeErrorDialog } from "@/components/GmailComposeErrorDialog";
import { VariableFallbackChip } from "@/components/VariableFallbackChip";
import { SubjectWithVariables, type SubjectHandle } from "@/components/SubjectWithVariables";
import { GmailAvatar } from "@/components/GmailAvatar";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { IconX } from "@/components/Icons";
import { GMAIL_COMPOSE_DIALOG_BORDER, GMAIL_COMPOSE_HEADER } from "@/lib/gmail-theme";
import type { ComposeDraftSaveStatus } from "@/lib/gmail-draft-autosave";
import type { ComposeVariable } from "@/lib/compose-variables";
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
  draftSaveStatus?: ComposeDraftSaveStatus;
  /** Gmail-style recipient validation error — blocks send until dismissed. */
  composeError?: string | null;
  onDismissComposeError?: () => void;

  /**
   * "docked" keeps the Gmail bottom-right window (the in-thread reply
   * composer). "centered" is the standalone Compose modal.
   */
  placement?: "docked" | "centered";
  /** Merge variables offered by the body editor's `{` picker. */
  variables?: ComposeVariable[];
  /**
   * Locks the To field to a read-only mirror of the side panel's selection.
   * Used for mass sending, where the audience is owned by the rail and typing
   * an address on the left would silently escape the merge/preview flow.
   */
  recipientsLocked?: boolean;
  /** Right-hand rail, rendered inside the dialog next to the editor. */
  sidePanel?: React.ReactNode;
  /** Small notice strip above the footer (outbox delivery hint). */
  footerNotice?: React.ReactNode;

  massSending?: boolean;
  onMassSendingChange?: (on: boolean) => void;
  massToggleDisabled?: boolean;
  sendLabel?: string;
  sending?: boolean;

  /**
   * Review screen — a read-only render of the draft with merge variables
   * resolved for one recipient. Recipient switching lives in the side panel.
   */
  review?: {
    toLabel: string;
    subject: string;
    bodyHtml: string;
    /** Variables that resolve to nothing for this recipient before fallbacks. */
    missingKeys?: string[];
    /** No directory card matched — explains why several variables are blank at once. */
    noContactCard?: boolean;
    /** Campaign-wide default per variable key, editable from the warning banner. */
    fallbacks?: Record<string, string>;
    onFallbackChange?: (key: string, value: string) => void;
  } | null;
  onBackToEditor?: () => void;
  /** Opens the review screen; omit to hide the button. */
  onReview?: () => void;
  reviewDisabled?: boolean;
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
    draftSaveStatus = "idle",
    composeError,
    onDismissComposeError,
    placement = "docked",
    variables,
    recipientsLocked,
    sidePanel,
    footerNotice,
    massSending,
    onMassSendingChange,
    massToggleDisabled,
    sendLabel,
    sending,
    review,
    onBackToEditor,
    onReview,
    reviewDisabled,
  } = props;

  const centered = placement === "centered";
  const reviewing = !!review;

  // The shared mailbox is what actually sends, so it is the only correct
  // From. Deliberately no fallback to sessionEmail (the signed-in user):
  // showing a personal address here would misrepresent where mail comes from.
  const { me } = useMeMailbox();
  const fromEmail = me?.mailboxEmail?.trim() || "";

  const editorRef = useRef<RichTextEditorHandle>(null);
  const subjectRef = useRef<SubjectHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  /**
   * Which field the caret was last in. The toolbar button steals focus before
   * its click fires, so "where the cursor is" has to be remembered on focus
   * rather than read at click time.
   */
  const lastFocusedRef = useRef<"subject" | "body">("body");

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
          className={cn(
            "fixed inset-0 z-[998]",
            // A centered modal needs a scrim at every width; the docked window
            // only dims on mobile, where it covers the screen anyway.
            centered ? "bg-black/40" : "bg-black/20 lg:hidden"
          )}
          aria-label={titleCase("Close compose")}
          onClick={onClose}
        />
      ) : null}

      {minimized ? (
        <div
          data-compose-dialog
          className={cn(
            "fixed bottom-0 left-0 right-0 z-[999] flex h-11 items-center gap-1 border px-2 lg:bottom-6 lg:left-auto lg:right-6 lg:h-10 lg:w-[560px] lg:rounded-t-lg",
            GMAIL_COMPOSE_HEADER,
            GMAIL_COMPOSE_DIALOG_BORDER,
            "shadow-[0_-4px_16px_rgba(60,64,67,0.25)] lg:shadow-lg"
          )}
          role="dialog"
          aria-label={windowTitle}
        >
          <button
            type="button"
            onClick={onMinimize}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#f1f3f4]"
            title={titleCase("Expand")}
          >
            <Maximize2 className="h-4 w-4" strokeWidth={2} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={onMinimize}
              className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[#202124]"
            >
              {subject.trim() || windowTitle}
            </button>
            <ComposeDraftSaveIndicator status={draftSaveStatus} className="flex" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#f1f3f4]"
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
              ? cn("left-[2.5%] right-[2.5%] top-[2.5%] bottom-[2.5%] rounded-lg border", GMAIL_COMPOSE_DIALOG_BORDER, "shadow-[0_24px_48px_rgba(60,64,67,0.3)]")
              : centered
              ? cn(
                  // Full-bleed sheet on mobile, centered modal from lg up.
                  "bottom-0 left-0 right-0 max-h-[92vh] rounded-t-2xl border-x border-t",
                  "lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:border",
                  GMAIL_COMPOSE_DIALOG_BORDER,
                  "shadow-[0_-8px_24px_rgba(60,64,67,0.18)] lg:shadow-[0_24px_48px_rgba(0,0,0,0.32)]"
                )
              : cn(
                  "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl border-x border-t lg:bottom-6 lg:left-auto lg:right-6 lg:rounded-t-lg lg:border",
                  GMAIL_COMPOSE_DIALOG_BORDER,
                  "shadow-[0_-8px_24px_rgba(60,64,67,0.18)] lg:shadow-[0_8px_10px_1px_rgba(60,64,67,0.12),0_3px_14px_2px_rgba(60,64,67,0.12)]"
                )
          )}
          style={
            !fullscreen
              ? centered
                ? {
                    // Widens to fit the recipient rail without reflowing the editor.
                    width: resizeW ?? (sidePanel ? 1000 : 720),
                    maxWidth: "calc(100vw - 48px)",
                    height: resizeH ?? "min(720px, calc(100vh - 96px))",
                  }
                : {
                    width: resizeW ?? 560,
                    height: resizeH ?? undefined,
                    maxHeight: resizeH ?? "min(640px, calc(100vh - 96px))",
                  }
              : undefined
          }
          role="dialog"
          aria-modal="true"
          aria-label={windowTitle}
        >
          {/* Edge-drag resize is docked-only — a centered modal is positioned
              by transform, so dragging an edge would fight the centering. */}
          {!fullscreen && !centered && (
            <>
              <div
                className="absolute top-0 left-0 right-0 h-1 cursor-n-resize z-10 hidden lg:block"
                onMouseDown={(e) => startResize(e, "n")}
              />
              <div
                className="absolute top-0 left-0 bottom-0 w-1 cursor-w-resize z-10 hidden lg:block"
                onMouseDown={(e) => startResize(e, "w")}
              />
              <div
                className="absolute top-0 left-0 h-3 w-3 cursor-nw-resize z-20 hidden lg:block"
                onMouseDown={(e) => startResize(e, "nw")}
              />
            </>
          )}
          <div className={cn("flex shrink-0 items-center gap-1 border-b border-[#e0e0e0] px-2 py-1.5", GMAIL_COMPOSE_HEADER)}>
            <h2 className="shrink-0 truncate pl-2 text-[13px] font-medium text-[#202124]">
              {reviewing ? "Review email" : windowTitle}
            </h2>
            {reviewing && (
              <span className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-[#e8eaed] px-2 py-0.5 text-[11px] font-medium text-[#3c4043]">
                <Eye className="h-3 w-3" />
                Previewing
              </span>
            )}
            <div className="min-w-0 flex-1" />
            <ComposeDraftSaveIndicator status={draftSaveStatus} className="mr-1 flex" />
            <button
              type="button"
              onClick={onMinimize}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#f1f3f4]"
              title={titleCase("Minimize")}
            >
              <Minus className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#f1f3f4]"
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#f1f3f4]"
              aria-label={titleCase("Close")}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1">
          <div className="scrollbar-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-white">

            {/* Read-only sender identity. Sends always go from the connected
                mailbox, so this is information, not a choice. Compose only —
                the in-thread reply composer keeps its tighter header. */}
            {centered ? (
              <div className="flex items-center gap-2 border-b border-[#f1f3f4] px-3 py-2.5">
                <span className="w-7 shrink-0 text-[13px] text-[#444746]">From</span>
                {fromEmail ? (
                  <>
                    {/* No isMe — that would show the signed-in user's Google
                        photo on a shared mailbox's address. */}
                    <GmailAvatar seed={fromEmail} email={fromEmail} name={fromEmail} size={22} />
                    <span className="min-w-0 truncate text-[13px] text-[#202124]">{fromEmail}</span>
                  </>
                ) : (
                  <span className="truncate text-[13px] text-[#70757a]">
                    No shared mailbox connected
                  </span>
                )}
              </div>
            ) : null}

            <div className="flex items-center border-b border-[#f1f3f4] px-3">
              {reviewing ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">To</span>
                  <span className="truncate text-[13px] text-[#202124]">{review.toLabel}</span>
                </div>
              ) : recipientsLocked ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">To</span>
                  {to.trim() ? (
                    <span className="truncate text-[13px] text-[#202124]">{to}</span>
                  ) : (
                    <span className="truncate text-[13px] text-[#70757a]">
                      Add recipients from the panel on the right
                    </span>
                  )}
                </div>
              ) : (
              <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                <RecipientField
                  placeholder="Recipients"
                  value={to}
                  onChange={onToChange}
                  suggestions={suggestions}
                />
              </div>
              )}
              {!ccBccOpen && !reviewing && !recipientsLocked && (
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

            {ccBccOpen && !reviewing && (
              <>
                <div className="flex items-center border-b border-[#f1f3f4] px-3">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">Cc</span>
                  <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                    <RecipientField placeholder="" value={cc} onChange={onCcChange} suggestions={suggestions} />
                  </div>
                </div>
                <div className="flex items-center border-b border-[#f1f3f4] px-3">
                  <span className="w-7 shrink-0 text-[13px] text-[#444746]">Bcc</span>
                  <div className={cn("min-w-0 flex-1 py-0.5", fieldGroupClass)}>
                    <RecipientField placeholder="" value={bcc} onChange={onBccChange} suggestions={suggestions} />
                  </div>
                </div>
              </>
            )}

            {contactsHint ? (
              <p className="border-b border-[#f1f3f4] bg-[#fef7e0] px-4 py-2 text-[12px] leading-snug text-[#b06000]">
                {contactsHint}
              </p>
            ) : null}

            {showSubject && (
              <div className="flex items-center gap-2 border-b border-[#f1f3f4] px-3 py-2.5">
                {reviewing ? (
                  <>
                    <span className="w-14 shrink-0 text-[13px] text-[#444746]">Subject</span>
                    <span className="truncate text-[15px] text-[#202124]">
                      {review.subject.trim() || "No subject"}
                    </span>
                  </>
                ) : (
                  <div
                    className="w-full"
                    onFocusCapture={() => { lastFocusedRef.current = "subject"; }}
                  >
                    <SubjectWithVariables
                      ref={subjectRef}
                      value={subject}
                      onChange={onSubjectChange}
                      placeholder="Subject"
                      variables={variables}
                    />
                  </div>
                )}
              </div>
            )}

            {reviewing ? (
              <>
                {review.missingKeys && review.missingKeys.length > 0 && (
                  <div className="border-b border-[#f1f3f4] bg-[#fef7e0] px-4 py-2 text-[12px] leading-snug text-[#b06000]">
                    <span>
                      {review.noContactCard
                        ? "No contact card matched this recipient. "
                        : "This contact has no value for these fields. "}
                      Hover a field to set a fallback:
                    </span>
                    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
                      {review.missingKeys.map((k) => (
                        <VariableFallbackChip
                          key={k}
                          variableKey={k}
                          value={review.fallbacks?.[k] ?? ""}
                          onChange={(v) => review.onFallbackChange?.(k, v)}
                        />
                      ))}
                    </span>
                  </div>
                )}
                <div
                  className="min-h-[200px] flex-1 px-3 py-3 text-[13px] leading-relaxed text-[#202124] [overflow-wrap:anywhere] [&_a]:text-[#1a73e8] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#ccc] [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
                  // Preview of the user's own draft with merge values substituted.
                  // Same HTML the send path will submit, rendered read-only.
                  dangerouslySetInnerHTML={{ __html: review.bodyHtml }}
                />
              </>
            ) : (
              <div
                className="flex min-h-0 flex-1 flex-col"
                onFocusCapture={() => { lastFocusedRef.current = "body"; }}
              >
                <RichTextEditor
                  ref={editorRef}
                  value={body}
                  onChange={onBodyChange}
                  placeholder="Compose email"
                  autoFocus
                  variables={variables}
                />
              </div>
            )}

            {attachmentChips}
          </div>
          {sidePanel}
          </div>

          {footerNotice}

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
            sending={sending}
            sendLabel={sendLabel}
            massSending={massSending}
            onMassSendingChange={onMassSendingChange}
            massToggleDisabled={massToggleDisabled}
            backLabel={reviewing ? "Back to editor" : undefined}
            onBack={reviewing ? onBackToEditor : undefined}
            onReview={reviewing ? undefined : onReview}
            reviewDisabled={reviewDisabled}
            onInsertVariable={
              variables?.length
                ? () => {
                    if (lastFocusedRef.current === "subject") subjectRef.current?.insertVariableTrigger();
                    else editorRef.current?.insertVariableTrigger();
                  }
                : undefined
            }
          />
        </div>
      )}
      {composeError && onDismissComposeError ? (
        <GmailComposeErrorDialog message={composeError} onDismiss={onDismissComposeError} />
      ) : null}
    </>,
    document.body
  );
}
