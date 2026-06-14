"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import type { WhatsAppTemplateMeta } from "@/lib/whatsapp-template-shared";
import { uploadWhatsAppMediaFile } from "@/lib/whatsapp-outbound-media-client";
import { IconSend } from "@/components/Icons";
import { WhatsAppEmojiPicker } from "@/components/WhatsAppEmojiPicker";
import { WhatsAppTemplatePanel } from "@/components/WhatsAppTemplatePanel";
import {
  WhatsAppMediaAttachmentPreview,
  WHATSAPP_MAX_ATTACHMENTS,
  type PendingAttachment,
} from "@/components/WhatsAppMediaAttachmentPreview";

export type WhatsAppSendPayload = {
  messageType: string;
  text?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFilename?: string;
  replyToId?: string;
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
  recipientValid: boolean;
  onSend: (payload: WhatsAppSendPayload) => void | Promise<void>;
  onSendAttachments?: (attachments: PendingAttachment[], caption: string) => void;
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
  recipientValid,
  onSend,
  onSendAttachments,
  onInsertEmoji,
  textareaRef,
  wrapperRef,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadGenRef = useRef<Record<string, number>>({});
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const fileByIdRef = useRef<Map<string, File>>(new Map());

  const resolvedTextareaRef = (textareaRef && "current" in (textareaRef as React.RefObject<HTMLTextAreaElement>)
    ? textareaRef
    : internalTextareaRef) as React.RefObject<HTMLTextAreaElement>;

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachHint, setAttachHint] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const hasAttachments = attachments.length > 0;
  const uploadingCount = attachments.filter((a) => a.status === "uploading").length;

  const selectedTemplate =
    templates.find((t) => t.name === selectedTemplateName) ?? templates[0];

  const revokePreview = useCallback((url: string) => {
    if (previewUrlsRef.current.delete(url)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      for (const url of Array.from(previewUrls)) URL.revokeObjectURL(url);
      previewUrls.clear();
    };
  }, []);

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
  }, [draft, resolvedTextareaRef, hasAttachments]);

  function startUpload(item: PendingAttachment, file: File) {
    const gen = (uploadGenRef.current[item.id] ?? 0) + 1;
    uploadGenRef.current[item.id] = gen;

    void (async () => {
      try {
        const data = await uploadWhatsAppMediaFile(file);
        if (uploadGenRef.current[item.id] !== gen) return;
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === item.id
              ? {
                  ...a,
                  status: "ready" as const,
                  remoteUrl: data.url,
                  kind: data.kind,
                  filename: data.filename,
                  error: undefined,
                }
              : a
          )
        );
      } catch (e) {
        if (uploadGenRef.current[item.id] !== gen) return;
        const msg = e instanceof Error ? e.message : "Upload failed";
        setAttachments((prev) =>
          prev.map((a) => (a.id === item.id ? { ...a, status: "failed" as const, error: msg } : a))
        );
      }
    })();
  }

  function queueFiles(files: FileList | File[]) {
    if (needsTemplate) return;
    setAttachMenuOpen(false);

    const list = Array.from(files);
    const room = WHATSAPP_MAX_ATTACHMENTS - attachments.length;
    const slice = list.slice(0, Math.max(0, room));

    const newItems: Array<{ item: PendingAttachment; file: File }> = [];
    for (const file of slice) {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
      newItems.push({
        file,
        item: {
          id,
          previewUrl,
          name: file.name || "upload",
          mimeType: file.type || "application/octet-stream",
          isImage,
          status: "uploading",
        },
      });
    }

    if (newItems.length) {
      setAttachments((prev) => [...prev, ...newItems.map((n) => n.item)]);
      for (const { item, file } of newItems) {
        fileByIdRef.current.set(item.id, file);
        startUpload(item, file);
      }
    }
  }

  function retryUpload(id: string) {
    const item = attachments.find((a) => a.id === id);
    const file = fileByIdRef.current.get(id);
    if (!item || item.status !== "failed" || !file) {
      fileRef.current?.click();
      return;
    }
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "uploading" as const, error: undefined } : a))
    );
    startUpload({ ...item, status: "uploading" }, file);
  }

  function removeAttachment(id: string) {
    uploadGenRef.current[id] = (uploadGenRef.current[id] ?? 0) + 1;
    fileByIdRef.current.delete(id);
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) revokePreview(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearAttachments() {
    for (const a of attachments) {
      uploadGenRef.current[a.id] = (uploadGenRef.current[a.id] ?? 0) + 1;
      fileByIdRef.current.delete(a.id);
      revokePreview(a.previewUrl);
    }
    setAttachments([]);
  }

  function templateFieldsFilled(): boolean {
    const count = selectedTemplate?.bodyParamCount ?? 2;
    const vars = templateVariables.slice(0, count);
    return vars.length >= count && vars.every((v) => v.trim().length > 0);
  }

  function canSend(): boolean {
    if (!recipientValid || uploadingCount > 0) return false;
    if (needsTemplate) return templateFieldsFilled();
    if (hasAttachments) {
      return attachments.every((a) => a.status === "ready" && a.remoteUrl);
    }
    return Boolean(draft.trim());
  }

  function handleSendClick() {
    if (needsTemplate) {
      void onSend({ messageType: "template" });
      return;
    }

    if (hasAttachments) {
      const caption = draft.trim();
      const items = [...attachments];
      for (const a of attachments) {
        uploadGenRef.current[a.id] = (uploadGenRef.current[a.id] ?? 0) + 1;
        fileByIdRef.current.delete(a.id);
      }
      for (const a of items) revokePreview(a.previewUrl);
      setAttachments([]);
      onDraftChange("");
      onSendAttachments?.(items, caption);
      return;
    }

    void onSend({ messageType: "text", text: draft.trim() });
  }

  const sessionMode = !needsTemplate;
  const showTemplatePanel = needsTemplate || templates.length > 0;

  return (
    <div className="relative shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      {showTemplatePanel ? (
        <WhatsAppTemplatePanel
          needsTemplate={needsTemplate}
          templates={templates}
          selectedTemplateName={selectedTemplateName}
          onTemplateChange={onTemplateChange}
          templateVariables={templateVariables}
          onTemplateVariablesChange={onTemplateVariablesChange}
          forceTemplate={forceTemplate}
          onForceTemplateChange={onForceTemplateChange}
        />
      ) : null}

      {hasAttachments ? (
        <WhatsAppMediaAttachmentPreview
          attachments={attachments}
          caption={draft}
          onCaptionChange={onDraftChange}
          onRemove={removeAttachment}
          onRemoveAll={clearAttachments}
          onRetry={retryUpload}
          onAddMore={() => fileRef.current?.click()}
        />
      ) : null}

      {attachHint ? (
        <p className="mb-1.5 rounded-lg bg-[var(--color-warning-light)] px-2.5 py-1.5 text-xs text-[var(--color-warning)]">
          {attachHint}
        </p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ods,.txt"
        onChange={(e) => {
          if (e.target.files?.length) queueFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex items-end gap-1.5">
        {sessionMode ? (
          <>
            <div className="relative shrink-0 pb-1">
              <button
                ref={emojiBtnRef}
                type="button"
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-[22px] leading-none text-[#54656f] transition hover:bg-black/[0.04]",
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
                className="flex h-10 w-10 items-center justify-center rounded-full text-[#54656f] transition hover:bg-black/[0.04] disabled:opacity-40"
                disabled={hasAttachments && attachments.length >= WHATSAPP_MAX_ATTACHMENTS}
                onClick={() => {
                  if (needsTemplate) {
                    setAttachMenuOpen(false);
                    setAttachHint(titleCase("Send the opening template first, then attach after they reply."));
                    return;
                  }
                  setAttachMenuOpen((o) => !o);
                  setEmojiOpen(false);
                }}
                aria-label={titleCase("Attach")}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1.5 1.5 0 1 1-3 0V6" />
                </svg>
              </button>
              {attachMenuOpen ? (
                <div className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-sm shadow-[var(--shadow-lg)]">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
                    onClick={() => fileRef.current?.click()}
                  >
                    {titleCase("Photo, video, or document")}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {!hasAttachments ? (
          <div className="mb-0.5 flex min-h-[42px] min-w-0 flex-1 items-end rounded-3xl border border-[var(--color-border)] bg-white px-3 py-1.5 shadow-[var(--shadow-sm)]">
            <textarea
              ref={resolvedTextareaRef}
              className={cn(
                "min-h-[24px] w-full flex-1 resize-none border-0 bg-transparent py-1 text-[15px] leading-snug text-[var(--color-text)] outline-none ring-0 focus:ring-0",
                EMOJI_FONT,
              )}
              placeholder={
                needsTemplate
                  ? titleCase("Complete template fields above to send")
                  : titleCase("Type a message")
              }
              rows={1}
              value={draft}
              disabled={needsTemplate}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canSend()) {
                  e.preventDefault();
                  handleSendClick();
                  const el = resolvedTextareaRef.current;
                  if (el) el.style.height = "auto";
                }
              }}
            />
          </div>
        ) : (
          <div className="mb-0.5 min-w-0 flex-1" />
        )}

        <button
          type="button"
          className={cn(
            "mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition shadow-sm",
            canSend()
              ? "bg-[#00a884] text-white hover:bg-[#008f72] hover:shadow-md"
              : "bg-[#8696a0]/35 text-white/90",
          )}
          disabled={!canSend()}
          onClick={() => {
            handleSendClick();
            const el = resolvedTextareaRef.current;
            if (el) el.style.height = "auto";
          }}
          aria-label={titleCase("Send")}
        >
          {uploadingCount > 0 ? (
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <IconSend className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}

export type { PendingAttachment };
