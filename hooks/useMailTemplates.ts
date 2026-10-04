"use client";

import { useCallback, useEffect, useState } from "react";
import type { MailTemplate, MailTemplateInput } from "@/lib/mail-template-types";

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

/** Keeps the cache ordered the way the API returns it: most recently used first. */
function byRecency(a: MailTemplate, b: MailTemplate): number {
  const aKey = a.lastUsedAt ?? "";
  const bKey = b.lastUsedAt ?? "";
  if (aKey !== bKey) return bKey.localeCompare(aKey);
  return b.updatedAt.localeCompare(a.updatedAt);
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

  return { templates, loading, error, configured, create, update, remove, touch };
}
