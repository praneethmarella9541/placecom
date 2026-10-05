"use client";

import { useCallback, useEffect, useState } from "react";
import { sendsAsDriveLink } from "@/lib/gmail-draft-limits";
import { uploadToSignedUrl } from "@/lib/upload-to-signed-url";
import { uploadLargeFileToDrive } from "@/lib/upload-large-file-to-drive";
import {
  type MailTemplate,
  type MailTemplateAttachment,
  type MailTemplateInput,
} from "@/lib/mail-template-types";

type ListResponse = { templates?: MailTemplate[]; configured?: boolean; error?: string };
type OneResponse = { template?: MailTemplate; error?: string };

/**
 * The caller's saved templates.
 *
 * Module-level cache rather than per-mount state: the composer and the sequence
 * step editor both mount this, and a mail page can hold several composers open
 * at once. Without the shared copy, saving a template in one would leave the
 * others showing a list that no longer exists.
 *
 * Deliberately NOT part of the login-time prefetch chain
 * (lib/workspace-feature-prefetch.ts). Templates are only ever read when
 * somebody opens the picker, and most sessions never do — warming them would
 * put a request on every login to populate a menu nobody clicked.
 */
let cache: MailTemplate[] | null = null;
let cachedConfigured = true;
let inflight: Promise<MailTemplate[]> | null = null;
const subscribers = new Set<(next: MailTemplate[]) => void>();

function publish(next: MailTemplate[]) {
  cache = next;
  // forEach, not for..of: the project's TS target predates Set iteration.
  subscribers.forEach((fn) => fn(next));
}

async function fetchTemplates(): Promise<MailTemplate[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/mail-templates");
      const data = (await res.json()) as ListResponse;
      // `configured: false` is the pre-migration case — an empty list, not a
      // failure. The 200 carries an `error` string the picker shows as a notice.
      if (!res.ok) throw new Error(data.error || "Failed to load templates");
      cachedConfigured = data.configured !== false;
      const templates = data.templates ?? [];
      publish(templates);
      return templates;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Templates whose files are still being copied into a draft or sequence step,
 * with a count because the same template can be mid-copy in two places. Kept
 * here, beside the cache, because the modal that offers "Use" has usually
 * closed by the time the copy it started finishes — the hosts mark the copy,
 * the modal reads it, and "Use" stays off until it is done, so a second click
 * can't attach the same files twice.
 */
const copying = new Map<string, number>();
const copySubscribers = new Set<(ids: Set<string>) => void>();

function copyingIds(): Set<string> {
  return new Set(Array.from(copying.keys()));
}

/** Mark a template as mid-copy; call the returned function once it has finished. */
export function markTemplateCopy(templateId: string): () => void {
  copying.set(templateId, (copying.get(templateId) ?? 0) + 1);
  copySubscribers.forEach((fn) => fn(copyingIds()));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (copying.get(templateId) ?? 1) - 1;
    if (left <= 0) copying.delete(templateId);
    else copying.set(templateId, left);
    copySubscribers.forEach((fn) => fn(copyingIds()));
  };
}

/** Ids of templates whose files are still being copied somewhere. */
export function useCopyingTemplates(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(copyingIds);
  useEffect(() => {
    copySubscribers.add(setIds);
    // A copy may have finished between render and subscribe.
    setIds(copyingIds());
    return () => {
      copySubscribers.delete(setIds);
    };
  }, []);
  return ids;
}

/**
 * A file picked in the template editor and already uploaded — to storage, or
 * to Google Drive when it is over Gmail's 25 MB (sendsAsDriveLink) — waiting
 * for Save to record it against the template.
 */
export type PickedUpload =
  | { kind: "stored"; path: string; filename: string; mimeType: string }
  | {
      kind: "drive";
      driveFile: { id: string; name: string; mimeType: string; size: number; webViewLink: string };
    };

/**
 * Upload a picked file straight away, reporting progress — the way compose
 * uploads an attachment the moment it is added — rather than waiting for Save.
 */
export async function uploadPickedFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<PickedUpload> {
  if (sendsAsDriveLink(file.size)) {
    let driveFile;
    try {
      driveFile = await uploadLargeFileToDrive(file, onProgress);
    } catch (e) {
      throw new Error(
        `Could not put "${file.name}" on Google Drive: ${e instanceof Error ? e.message : "network error"}`
      );
    }
    return {
      kind: "drive",
      driveFile: {
        id: driveFile.id,
        name: driveFile.name || file.name,
        mimeType: driveFile.mimeType || file.type || "application/octet-stream",
        size: file.size,
        webViewLink: driveFile.webViewLink,
      },
    };
  }

  const signRes = await fetch("/api/mail-templates/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size }),
  });
  const signed = (await signRes.json().catch(() => ({}))) as {
    path?: string;
    signedUrl?: string;
    error?: string;
  };
  if (!signRes.ok || !signed.path || !signed.signedUrl) {
    throw new Error(signed.error || `Could not attach "${file.name}"`);
  }
  try {
    await uploadToSignedUrl(signed.signedUrl, file, onProgress);
  } catch (e) {
    throw new Error(
      `Could not upload "${file.name}": ${e instanceof Error ? e.message : "network error"}`
    );
  }
  return { kind: "stored", path: signed.path, filename: file.name, mimeType: file.type };
}

/**
 * Drop an upload that was never saved (removed before Save, or the edit was
 * discarded). Best-effort; a Drive file stays in the user's Drive, as compose's do.
 */
export function discardPickedUpload(upload: PickedUpload): void {
  if (upload.kind !== "stored") return;
  void fetch("/api/mail-templates/uploads", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: upload.path }),
  }).catch(() => {});
}

/** Keeps the cache ordered the way the API returns it: most recently used first. */
function byRecency(a: MailTemplate, b: MailTemplate): number {
  const aKey = a.lastUsedAt ?? "";
  const bKey = b.lastUsedAt ?? "";
  if (aKey !== bKey) return bKey.localeCompare(aKey);
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Rewrite one cached template in place, keeping the list's order. */
function patchCached(id: string, fn: (t: MailTemplate) => MailTemplate) {
  publish((cache ?? []).map((t) => (t.id === id ? fn(t) : t)));
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

/**
 * @param enabled Gates the fetch. Pass the picker's open state so the request
 *   happens the first time somebody actually looks, not on every page mount.
 */
export function useMailTemplates(enabled: boolean) {
  const [templates, setTemplates] = useState<MailTemplate[]>(cache ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(cachedConfigured);

  useEffect(() => {
    subscribers.add(setTemplates);
    return () => {
      subscribers.delete(setTemplates);
    };
  }, []);

  useEffect(() => {
    if (!enabled || cache !== null) return;
    setLoading(true);
    setError(null);
    fetchTemplates()
      .then(() => setConfigured(cachedConfigured))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setLoading(false));
  }, [enabled]);

  const create = useCallback(async (input: MailTemplateInput): Promise<MailTemplate> => {
    const res = await fetch("/api/mail-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as OneResponse;
    if (!res.ok || !data.template) {
      throw new Error(data.error || "Failed to save template");
    }
    publish([data.template, ...(cache ?? [])].sort(byRecency));
    return data.template;
  }, []);

  const update = useCallback(
    async (id: string, patch: Partial<MailTemplateInput>): Promise<MailTemplate> => {
      const res = await fetch(`/api/mail-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as OneResponse;
      if (!res.ok || !data.template) {
        throw new Error(data.error || "Failed to update template");
      }
      publish(
        (cache ?? []).map((t) => (t.id === id ? data.template! : t)).sort(byRecency)
      );
      return data.template;
    },
    []
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    // Optimistic: the row leaves the list before the request lands, and comes
    // back if the delete fails. A template is cheap to re-render and the menu
    // feels broken if a confirmed delete sits there for a round trip.
    const before = cache ?? [];
    publish(before.filter((t) => t.id !== id));
    const res = await fetch(`/api/mail-templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      publish(before);
      throw new Error(await readError(res, "Failed to delete template"));
    }
  }, []);

  /**
   * Records that a template was inserted, so the picker leads with it next
   * time. Fire-and-forget on purpose: the insert has already happened in the
   * editor, and failing to log it is not worth an error in the user's face.
   */
  const touch = useCallback((id: string) => {
    const now = new Date().toISOString();
    publish((cache ?? []).map((t) => (t.id === id ? { ...t, lastUsedAt: now } : t)).sort(byRecency));
    void fetch(`/api/mail-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch: true }),
    }).catch(() => {});
  }, []);

  /**
   * Record a file that was already uploaded when it was picked (see
   * uploadPickedFile) against a saved template. Fast — the bytes are in place.
   */
  const recordUpload = useCallback(
    async (templateId: string, upload: PickedUpload): Promise<MailTemplateAttachment> => {
      const res = await fetch(`/api/mail-templates/${templateId}/attachments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          upload.kind === "drive"
            ? { driveFile: upload.driveFile }
            : { path: upload.path, filename: upload.filename, mimeType: upload.mimeType }
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        attachment?: MailTemplateAttachment;
        error?: string;
      };
      const name = upload.kind === "drive" ? upload.driveFile.name : upload.filename;
      if (!res.ok || !data.attachment) {
        throw new Error(data.error || `Could not attach "${name}"`);
      }
      const added = data.attachment;
      patchCached(templateId, (t) => ({ ...t, attachments: [...t.attachments, added] }));
      return added;
    },
    []
  );

  const removeAttachment = useCallback(async (templateId: string, attachmentId: string) => {
    const res = await fetch(`/api/mail-templates/${templateId}/attachments/${attachmentId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(await readError(res, "Could not remove the attachment"));
    patchCached(templateId, (t) => ({
      ...t,
      attachments: t.attachments.filter((a) => a.id !== attachmentId),
    }));
  }, []);

  return {
    templates,
    loading,
    error,
    configured,
    create,
    update,
    remove,
    touch,
    recordUpload,
    removeAttachment,
  };
}
