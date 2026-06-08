"use client";

import { useEffect, useState } from "react";
import { useContactPhoto, useMePhotoUrl } from "@/components/ContactPhotoProvider";
import { gmailAvatarColor, gmailAvatarInitial } from "@/lib/gmail-avatar";
import { normalizeGooglePhotoUrl } from "@/lib/google-photo-url";
import { cn } from "@/lib/utils";

type GmailAvatarProps = {
  /** Email or stable id used to pick avatar color. */
  seed: string;
  name: string;
  size?: number;
  className?: string;
  /** Explicit photo URL (e.g. Drive permission photoLink). */
  photoUrl?: string | null;
  /** Email for contact-photo lookup; defaults to seed. */
  email?: string;
  /** When true, use the signed-in user's Google profile photo. */
  isMe?: boolean;
};

/** Gmail-style avatar — Google profile photo when available, else colored initial. */
export function GmailAvatar({
  seed,
  name,
  size = 40,
  className,
  photoUrl: photoUrlProp,
  email,
  isMe = false,
}: GmailAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const lookupEmail = (email ?? seed).trim().toLowerCase();
  const cachedPhoto = useContactPhoto(lookupEmail);
  const mePhoto = useMePhotoUrl();
  const rawPhoto = photoUrlProp ?? (isMe ? mePhoto : cachedPhoto);
  const resolvedPhoto = rawPhoto ? normalizeGooglePhotoUrl(rawPhoto, size * 2) : undefined;
  const showPhoto = Boolean(resolvedPhoto) && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [resolvedPhoto]);

  const bg = gmailAvatarColor(seed);
  const initial = gmailAvatarInitial(name);
  const fontSize = size >= 40 ? 16 : size >= 32 ? 13 : size >= 24 ? 11 : 10;

  if (showPhoto && resolvedPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolvedPhoto}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={cn("shrink-0 rounded-full object-cover bg-[var(--color-surface-offset)]", className)}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
