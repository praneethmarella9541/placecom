"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeGooglePhotoUrl } from "@/lib/google-photo-url";

type ContactPhotoContextValue = {
  ready: boolean;
  mePhotoUrl?: string;
  getPhoto: (email: string) => string | undefined;
  mergePhotos: (map: Record<string, string>) => void;
};

const ContactPhotoContext = createContext<ContactPhotoContextValue | null>(null);

export function ContactPhotoProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mePhotoUrl, setMePhotoUrl] = useState<string | undefined>();
  const [photoByEmail, setPhotoByEmail] = useState<Record<string, string>>({});

  const mergePhotos = useCallback((map: Record<string, string>) => {
    if (!Object.keys(map).length) return;
    setPhotoByEmail((prev) => {
      const next = { ...prev };
      for (const [email, url] of Object.entries(map)) {
        const key = email.trim().toLowerCase();
        if (key && url) next[key] = normalizeGooglePhotoUrl(url);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/gmail/contacts")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const photoMap = raw.photoByEmail as Record<string, string> | undefined;
        if (photoMap && typeof photoMap === "object") mergePhotos(photoMap);
        const contacts = raw.contacts as Array<{ email?: string; photoUrl?: string }> | undefined;
        if (Array.isArray(contacts)) {
          const fromContacts: Record<string, string> = {};
          for (const c of contacts) {
            const email = c.email?.trim().toLowerCase();
            if (email && c.photoUrl) fromContacts[email] = c.photoUrl;
          }
          mergePhotos(fromContacts);
        }
        if (typeof raw.mePhotoUrl === "string" && raw.mePhotoUrl.trim()) {
          setMePhotoUrl(normalizeGooglePhotoUrl(raw.mePhotoUrl.trim()));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mergePhotos]);

  const getPhoto = useCallback(
    (email: string) => {
      const key = email.trim().toLowerCase();
      return key ? photoByEmail[key] : undefined;
    },
    [photoByEmail],
  );

  const value = useMemo(
    () => ({ ready, mePhotoUrl, getPhoto, mergePhotos }),
    [ready, mePhotoUrl, getPhoto, mergePhotos],
  );

  return <ContactPhotoContext.Provider value={value}>{children}</ContactPhotoContext.Provider>;
}

export function useContactPhoto(email?: string | null): string | undefined {
  const ctx = useContext(ContactPhotoContext);
  const key = email?.trim().toLowerCase() ?? "";
  if (!ctx || !key) return undefined;
  return ctx.getPhoto(key);
}

export function useMePhotoUrl(): string | undefined {
  return useContext(ContactPhotoContext)?.mePhotoUrl;
}

export function useContactPhotoActions() {
  return useContext(ContactPhotoContext);
}

/** Fetch Google profile photos for emails not yet in the session cache. */
export function useResolveContactPhotos(emails: string[]) {
  const ctx = useContext(ContactPhotoContext);
  const emailsKey = useMemo(
    () =>
      Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))).sort().join("|"),
    [emails],
  );

  useEffect(() => {
    if (!ctx || !emailsKey) return;
    const list = emailsKey.split("|");
    const missing = list.filter((e) => !ctx.getPhoto(e));
    if (!missing.length) return;

    let cancelled = false;
    void fetch("/api/people/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: missing }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.photos || typeof j.photos !== "object") return;
        ctx.mergePhotos(j.photos as Record<string, string>);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [ctx, emailsKey]);
}
