"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import {
  applyTemplatePreview,
  templateVariableLabels,
  type WhatsAppTemplateMeta,
} from "@/lib/whatsapp-template-shared";
import { IconSend, IconX } from "@/components/Icons";
import { WhatsAppEmojiPicker } from "@/components/WhatsAppEmojiPicker";

export type WhatsAppSendPayload = {
  messageType: string;
  text?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFilename?: string;
};

type Props = {
  needsTemplate: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  templates: WhatsAppTemplateMeta[];
  selectedTemplateName: string;
  onTemplateChange: (name: string) => void;
  templateVariables: string[];
  onTemplateVariablesChange: (vars: string[]) => void;
  forceTemplate: boolean;
  onForceTemplateChange: (v: boolean) => void;
  uploading: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  recipientValid: boolean;
  onSend: (payload: WhatsAppSendPayload) => void | Promise<void>;
  onInsertEmoji: (emoji: string) => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  wrapperRef?: React.Ref<HTMLDivElement>;
};

const EMOJI_FONT =
  "[font-family:system-ui,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol','Apple_Color_Emoji','Noto_Color_Emoji']";

export function WhatsAppComposerBar({
  needsTemplate,
  draft,
  onDraftChange,
  templates,
  selectedTemplateName,
  onTemplateChange,
  templateVariables,
  onTemplateVariablesChange,
  forceTemplate,
  onForceTemplateChange,
  uploading,
  onUploadingChange,
  recipientValid,
  onSend,
  onInsertEmoji,
  textareaRef,
  wrapperRef,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = (textareaRef && "current" in (textareaRef as React.RefObject<HTMLTextAreaElement>)
    ? textareaRef
    : internalTextareaRef) as React.RefObject<HTMLTextAreaElement>;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{
    url: string;
    kind: string;
    filename: string;
  } | null>(null);

  const selectedTemplate =
    templates.find((t) => t.name === selectedTemplateName) ?? templates[0];

  const templatePreview =
    selectedTemplate && templateVariables.some((v) => v.trim())
      ? applyTemplatePreview(selectedTemplate, templateVariables)
      : selectedTemplate?.preview.replace(/\{\{\d+\}\}/g, "…") ?? "";

  const varLabels = templateVariableLabels(selectedTemplate?.bodyParamCount ?? 2);

  useEffect(() => {
    if (!emojiOpen && !attachMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      const el = wrapperRef && "current" in wrapperRef ? wrapperRef.current : null;
      if (el && !el.contains(node)) {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen, attachMenuOpen, wrapperRef]);

  useEffect(() => {
    const el = resolvedTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft, resolvedTextareaRef]);

  async function handleFile(file: File) {
    setUploadError(null);
    onUploadingChange?.(true);
    setAttachMenuOpen(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/whatsapp/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; url?: string; kind?: string; filename?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setPendingMedia({
        url: data.url!,
        kind: data.kind || "document",
        filename: data.filename || file.name,
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      onUploadingChange?.(false);
    }
  }

  function templateFieldsFilled(): boolean {
    const count = selectedTemplate?.bodyParamCount ?? 2;
    const vars = templateVariables.slice(0, count);
    return vars.length >= count && vars.every((v) => v.trim().length > 0);
  }

  function canSend(): boolean {
    if (!recipientValid || uploading) return false;
    if (needsTemplate) return templateFieldsFilled();
    if (pendingMedia) return true;
    return Boolean(draft.trim());
  }

  function handleSendClick() {
    if (needsTemplate) {
      void onSend({ messageType: "template" });
      return;
    }
    if (pendingMedia) {
      void onSend({
        messageType: pendingMedia.kind,
        mediaUrl: pendingMedia.url,
        mediaCaption: draft.trim() || undefined,
        mediaFilename: pendingMedia.filename,
      });
      setPendingMedia(null);
      onDraftChange("");
      return;
    }
    void onSend({ messageType: "text", text: draft.trim() });
  }

  const sessionMode = !needsTemplate;

  return (
    <div className="relative shrink-0 bg-[#f0f2f5] px-2 py-2 dark:bg-[#111b21]">
      {needsTemplate ? (
        <div className="mb-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">{titleCase("Opening message uses approved template")}</p>
          {templates.length > 1 ? (
            <label className="block">
              <span className="text-[11px] font-medium">{titleCase("Template")}</span>
              <select
                className="input-field mt-1 w-full text-sm"
                value={selectedTemplateName}
                onChange={(e) => onTemplateChange(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label} ({t.name})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="leading-relaxed opacity-90">
              Template:{" "}
              <span className="font-mono">{selectedTemplate?.name ?? "initial_conversation"}</span>
            </p>
          )}
          <p className="leading-relaxed opacity-90">{templatePreview}</p>
          <div
            className={cn(
              "grid gap-2",
              varLabels.length > 2 ? "sm:grid-cols-2" : "sm:grid-cols-2"
            )}
          >
            {varLabels.map((label, i) => (
              <label key={label} className="block">
                <span className="text-[11px] font-medium">{titleCase(label)}</span>
                <input
                  className="input-field mt-1 w-full text-sm"
                  value={templateVariables[i] ?? ""}
                  onChange={(e) => {
                    const next = [...templateVariables];
                    next[i] = e.target.value;
                    onTemplateVariablesChange(next);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={forceTemplate} onChange={(e) => onForceTemplateChange(e.target.checked)} />
            <span>{titleCase("Always use template")}</span>
          </label>
        </div>
      ) : (
        <div className="mb-1.5 space-y-1.5">
          {templates.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
              <span>{titleCase("Template if needed")}:</span>
              <select
                className="input-field max-w-[220px] py-1 text-xs"
                value={selectedTemplateName}
                onChange={(e) => onTemplateChange(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={forceTemplate} onChange={(e) => onForceTemplateChange(e.target.checked)} />
            <span>{titleCase("Send as template")}</span>
          </label>
        </div>
      )}

      {pendingMedia ? (
        <div className="mb-1.5 flex items-center justify-between rounded-lg bg-white/90 px-2 py-1 text-xs shadow-sm dark:bg-zinc-900">
          <span className="truncate">
            {pendingMedia.kind}: {pendingMedia.filename}
          </span>
          <button type="button" onClick={() => setPendingMedia(null)} aria-label="Remove">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {uploadError ? <p className="mb-1 text-xs text-red-700">{uploadError}</p> : null}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-end gap-1">
        {sessionMode ? (
          <>
            <div className="relative shrink-0 pb-1">
              <button
                ref={emojiBtnRef}
                type="button"
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-[22px] leading-none text-[#54656f] transition hover:bg-black/5 dark:text-[#aebac1] dark:hover:bg-white/10",
                  EMOJI_FONT,
                )}
                onClick={() => {
                  setEmojiOpen((o) => !o);
                  setAttachMenuOpen(false);
                }}
                aria-label={titleCase("Emoji")}
              >
                😊
              </button>
              <WhatsAppEmojiPicker
                open={emojiOpen}
                anchorRef={emojiBtnRef}
                onPick={(em) => {
                  onInsertEmoji(em);
                  setEmojiOpen(false);
                }}
              />
            </div>

            <div className="relative shrink-0 pb-1">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-[#54656f] transition hover:bg-black/5 dark:text-[#aebac1] dark:hover:bg-white/10"
                onClick={() => {
                  setAttachMenuOpen((o) => !o);
                  setEmojiOpen(false);
                }}
                aria-label={titleCase("Attach")}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path
                    strokeLinecap="round"
                    d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1.5 1.5 0 1 1-3 0V6"
                  />
                </svg>
              </button>
              {attachMenuOpen ? (
                <div className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? titleCase("Uploading…") : titleCase("Photo, video, or document")}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="mb-0.5 flex min-h-[42px] min-w-0 flex-1 items-end rounded-3xl bg-white px-3 py-1.5 shadow-sm dark:bg-[#2a3942]">
          <textarea
            ref={resolvedTextareaRef}
            className={cn(
              "min-h-[24px] w-full flex-1 resize-none border-0 bg-transparent py-1 text-[15px] leading-snug text-zinc-900 outline-none ring-0 focus:ring-0 dark:text-[#e9edef]",
              EMOJI_FONT,
            )}
            placeholder={
              needsTemplate ? titleCase("Template fields above") : pendingMedia ? titleCase("Caption") : titleCase("Type a message")
            }
            rows={1}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSend()) {
                e.preventDefault();
                handleSendClick();
                const el = resolvedTextareaRef.current;
                if (el) { el.style.height = "auto"; }
              }
            }}
          />
        </div>

        <button
          type="button"
          className={cn(
            "mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition",
            canSend()
              ? "bg-[#00a884] text-white hover:bg-[#008f72]"
              : "bg-[#8696a0]/40 text-white/80",
          )}
          disabled={!canSend()}
          onClick={() => { handleSendClick(); const el = resolvedTextareaRef.current; if (el) el.style.height = "auto"; }}
          aria-label={titleCase("Send")}
        >
          {uploading ? (
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <IconSend className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
