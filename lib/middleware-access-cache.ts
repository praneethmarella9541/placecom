import type { NextRequest, NextResponse } from "next/server";
import type { FeatureKey } from "@/lib/feature-access";

const COOKIE_NAME = "placecom_access_v1";
const MAX_AGE_SEC = 60 * 10;

export type MiddlewareAccessCache = {
  uid: string;
  role: string;
  restricted: FeatureKey[];
  groupId: string | null;
};

export function readMiddlewareAccessCache(
  request: NextRequest,
  userId: string
): MiddlewareAccessCache | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MiddlewareAccessCache;
    if (parsed.uid !== userId) return null;
    if (typeof parsed.role !== "string") return null;
    if (!Array.isArray(parsed.restricted)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeMiddlewareAccessCache(
  response: NextResponse,
  cache: MiddlewareAccessCache
): void {
  response.cookies.set(COOKIE_NAME, JSON.stringify(cache), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}
