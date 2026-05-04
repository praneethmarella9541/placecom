"use client";

import { useEffect, useRef } from "react";

/** After load, admins persist Google refresh token server-side (no UI). */
export function MailboxSessionSync() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void fetch("/api/mailbox/register-session", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
