import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { loadModuleConfig } from "@/lib/module-config-store";

/**
 * Server-side guard for the /configs "Allow delete" switch. Hiding the button
 * is not enough — every route that removes or trashes something must call
 * this first and return its response when non-null.
 *
 * Fails closed: if the config cannot be read, delete stays off.
 */
export async function deleteForbiddenResponse(): Promise<NextResponse | null> {
  try {
    const config = await loadModuleConfig(createServiceSupabase());
    if (config.allowDelete) return null;
  } catch {
    /* service role env missing or read failed — treat as off */
  }
  return NextResponse.json(
    { error: "Deleting is turned off for this workspace." },
    { status: 403 },
  );
}
