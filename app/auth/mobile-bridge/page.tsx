"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "nucleusMobileOAuthReturn";

/**
 * Expo Go entry: stash exp:// return URI, then redirect to Supabase OAuth.
 * The shared /auth/callback page reads sessionStorage and hands off to Expo Go.
 */
export default function MobileOAuthBridgePage() {
  const [message, setMessage] = useState("Starting Google sign-in…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnUri = params.get("return");
    const authUrl = params.get("auth");

    if (!returnUri || !authUrl) {
      setMessage("Invalid sign-in link. Close this tab and try again in the app.");
      return;
    }

    if (!returnUri.startsWith("exp://") && !returnUri.startsWith("thenucleus://")) {
      setMessage("Invalid return URL. Close this tab and try again in the app.");
      return;
    }

    try {
      sessionStorage.setItem(STORAGE_KEY, returnUri);
    } catch {
      setMessage("Could not start sign-in in this browser. Close the tab and try again.");
      return;
    }

    setMessage("Redirecting to Google…");
    window.location.replace(authUrl);
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 32,
        textAlign: "center",
        maxWidth: 420,
        margin: "40px auto",
      }}
    >
      <p style={{ fontWeight: 600 }}>The Nucleus</p>
      <p style={{ color: "#666", fontSize: 14, marginTop: 12 }}>{message}</p>
    </main>
  );
}
