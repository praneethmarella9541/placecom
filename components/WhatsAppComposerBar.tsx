"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { IconSend, IconX } from "@/components/Icons";

export type WhatsAppSendPayload = {
  messageType: string;
  text?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFilename?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactiveBody?: string;
  interactiveButtons?: Array<{ id: string; title: string }>;
};

type Props = {
  needsTemplate: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  templateVar1: string;
  templateVar2: string;
  onTemplateVar1Change: (v: string) => void;
  onTemplateVar2Change: (v: string) => void;
  forceTemplate: boolean;
  onForceTemplateChange: (v: boolean) => void;
  templateName?: string;
  templatePreview?: string;
  sending: boolean;
  recipientValid: boolean;
  onSend: (payload: WhatsAppSendPayload) => void | Promise<void>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};

export function WhatsAppComposerBar({
  needsTemplate,
  draft,
  onDraftChange,
  templateVar1,
  templateVar2,
  onTemplateVar1Change,
  onTemplateVar2Change,
  forceTemplate,
  onForceTemplateChange,
  templateName,
  templatePreview,
  sending,
  recipientValid,
  onSend,
  textareaRef,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{
    url: string;
    kind: string;
    filename: string;
  } | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [btnOpen, setBtnOpen] = useState(false);
  const [btnBody, setBtnBody] = useState("");
  const [btn1, setBtn1] = useState("");
  const [btn2, setBtn2] = useState("");

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
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
      setAttachOpen(false);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function canSend(): boolean {
    if (!recipientValid || sending || uploading) return false;
    if (needsTemplate) return Boolean(templateVar1.trim() && templateVar2.trim());
    if (pendingMedia) return true;
    if (locOpen) return Boolean(lat.trim() && lng.trim());
    if (btnOpen) return Boolean(btnBody.trim() && btn1.trim());
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
    if (locOpen) {
      void onSend({
        messageType: "location",
        location: {
          latitude: Number(lat),
          longitude: Number(lng),
          name: locName.trim() || undefined,
          address: locAddress.trim() || undefined,
        },
      });
      setLocOpen(false);
      return;
    }
    if (btnOpen) {
      const buttons = [
        { id: "btn_1", title: btn1.trim() },
        ...(btn2.trim() ? [{ id: "btn_2", title: btn2.trim() }] : []),
      ];
      void onSend({
        messageType: "interactive",
        interactiveBody: btnBody.trim(),
        interactiveButtons: buttons,
      });
      setBtnOpen(false);
      return;
    }
    void onSend({ messageType: "text", text: draft.trim() });
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-[#f0f2f5] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      {!needsTemplate ? (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => setAttachOpen((o) => !o)}
          >
            📎 {titleCase("Attach")}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-lg px-2 py-1 text-xs font-medium",
              locOpen ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950" : "text-zinc-700 hover:bg-white dark:text-zinc-300"
            )}
            onClick={() => {
              setLocOpen((o) => !o);
              setBtnOpen(false);
            }}
          >
            📍 {titleCase("Location")}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-lg px-2 py-1 text-xs font-medium",
              btnOpen ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950" : "text-zinc-700 hover:bg-white dark:text-zinc-300"
            )}
            onClick={() => {
              setBtnOpen((o) => !o);
              setLocOpen(false);
            }}
          >
            🔘 {titleCase("Buttons")}
          </button>
          <span className="text-[10px] text-zinc-500">Session only · groups via Exotel OBA</span>
        </div>
      ) : null}

      {attachOpen && !needsTemplate ? (
        <div className="mb-2 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
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
          <button
            type="button"
            className="btn-secondary w-full py-2 text-xs"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? titleCase("Uploading…") : titleCase("Choose image, video, audio, or document")}
          </button>
          {uploadError ? <p className="mt-1 text-xs text-red-700">{uploadError}</p> : null}
        </div>
      ) : null}

      {pendingMedia ? (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-2 py-1.5 text-xs dark:bg-amber-950/40">
          <span>
            Ready: {pendingMedia.kind} — {pendingMedia.filename}
          </span>
          <button type="button" onClick={() => setPendingMedia(null)} aria-label="Remove">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {locOpen && !needsTemplate ? (
        <div className="mb-2 grid gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950 sm:grid-cols-2">
          <input className="input-field" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="input-field" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
          <input className="input-field sm:col-span-2" placeholder="Place name (optional)" value={locName} onChange={(e) => setLocName(e.target.value)} />
          <input className="input-field sm:col-span-2" placeholder="Address (optional)" value={locAddress} onChange={(e) => setLocAddress(e.target.value)} />
        </div>
      ) : null}

      {btnOpen && !needsTemplate ? (
        <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
          <input className="input-field w-full" placeholder="Message above buttons" value={btnBody} onChange={(e) => setBtnBody(e.target.value)} />
          <div className="flex gap-2">
            <input className="input-field flex-1" placeholder="Button 1 label" value={btn1} onChange={(e) => setBtn1(e.target.value)} />
            <input className="input-field flex-1" placeholder="Button 2 (optional)" value={btn2} onChange={(e) => setBtn2(e.target.value)} />
          </div>
        </div>
      ) : null}

      {needsTemplate ? (
        <div className="mb-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">{titleCase("Opening message uses approved template")}</p>
          <p className="leading-relaxed opacity-90">
            Template: <span className="font-mono">{templateName ?? "initial_conversation"}</span> — {templatePreview}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-medium">{titleCase("{{1}} Recipient name")}</span>
              <input className="input-field mt-1 w-full text-sm" value={templateVar1} onChange={(e) => onTemplateVar1Change(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium">{titleCase("{{2}} Your name")}</span>
              <input className="input-field mt-1 w-full text-sm" value={templateVar2} onChange={(e) => onTemplateVar2Change(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={forceTemplate} onChange={(e) => onForceTemplateChange(e.target.checked)} />
            <span>{titleCase("Always use template")}</span>
          </label>
        </div>
      ) : (
        <label className="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={forceTemplate} onChange={(e) => onForceTemplateChange(e.target.checked)} />
          <span>{titleCase("Send as template instead of free text")}</span>
        </label>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className="input-field max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl py-2.5 text-base"
          placeholder={
            needsTemplate
              ? titleCase("Template sends above — not used for body")
              : pendingMedia
                ? titleCase("Optional caption")
                : titleCase("Message")
          }
          rows={2}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend()) {
              e.preventDefault();
              handleSendClick();
            }
          }}
        />
        <button
          type="button"
          className="btn-primary mb-0.5 shrink-0 rounded-full px-4 py-2.5"
          disabled={!canSend()}
          onClick={() => handleSendClick()}
        >
          {sending || uploading ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <IconSend className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
