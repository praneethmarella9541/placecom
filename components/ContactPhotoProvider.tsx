"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

type ContactPhotoContextValue = {
  ready: boolean;
  mePhotoUrl?: string;
  getPhoto: (email: string) => string | undefined;
  mergePhotos: (map: Record<string, string>) => void;
};

const ContactPhotoContext = createContext<ContactPhotoContextValue | null>(null);

export function ContactPhotoProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ContactPhotoContextValue>(
    () => ({
      ready: true,
      mePhotoUrl: undefined,
      getPhoto: () => undefined,
      mergePhotos: () => {},
    }),
    [],
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

/** No-op — profile photo lookup disabled; GmailAvatar uses initials only. */
export function useResolveContactPhotos(_emails: string[]) {}
