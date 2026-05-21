/**
 * Helper: forward a request to the FastAPI meeting-bot service.
 *
 * The user's Supabase JWT (from Bearer header or cookie session) is forwarded
 * verbatim. FastAPI verifies it with SUPABASE_JWT_SECRET (same one the mobile
 * app uses), so the proxy is just a pass-through — no separate service auth
 * required.
 */

import "server-only";
import { NextResponse } from "next/server";
import { getAuthedRequest } from "@/lib/api-auth";

export type ProxyResult =
  | { ok: true; data: unknown; status: number }
  | { ok: false; error: string; status: number };

function getBaseUrl(): string {
  const url = process.env.MEETING_BOT_BASE_URL?.trim();
  if (!url) throw new Error("MEETING_BOT_BASE_URL is not set");
  return url.replace(/\/$/, "");
}

export async function proxyToMeetingBot(
  request: Request,
  path: string,
  init?: RequestInit
): Promise<NextResponse> {
  const authed = await getAuthedRequest(request);
  // Forward whatever Bearer/JWT the caller sent. If the caller is a cookie-only
  // session (web), we need to ask Supabase for a token. For Phase 1 we require
  // an explicit Bearer so the mobile + web SPA both work via Supabase JWT.
  const auth = request.headers.get("Authorization") ?? "";
  if (!authed) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Bearer token required" }, { status: 401 });
  }

  const url = `${getBaseUrl()}${path}`;
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", auth);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return NextResponse.json(body ?? {}, { status: res.status });
}
