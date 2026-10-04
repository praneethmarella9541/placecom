import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { assertConfigsAccess } from "@/lib/configs-auth";
import {
  normalizeModuleConfig,
  type ModuleConfig,
} from "@/lib/module-config";
import {
  MODULE_CONFIG_STALE_COOKIE,
  MODULE_CONFIG_STALE_MAX_AGE_SEC,
  MODULE_CONFIG_TABLE,
  invalidateModuleConfigCache,
  loadModuleConfig,
} from "@/lib/module-config-store";

export const runtime = "nodejs";

/** Shape returned to the /configs page. */
type ModuleConfigResponse = {
  config: ModuleConfig;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

/** GET /api/configs/modules — current platform module config. */
export async function GET(request: Request) {
  const auth = await assertConfigsAccess(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Read through the service client so the page shows updated_at/updated_by,
  // which the read-only RLS policy exposes but the page has no other way to get
  // audit detail for.
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data, error } = await svc
    .from(MODULE_CONFIG_TABLE)
    .select("config, updated_at, updated_by")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    if (new RegExp(MODULE_CONFIG_TABLE, "i").test(error.message ?? "")) {
      return NextResponse.json(
        { error: "Run migration 0066_platform_module_config.sql before using /configs." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let updatedByEmail: string | null = null;
  if (data?.updated_by) {
    const { data: who } = await svc
      .from("profiles")
      .select("display_username")
      .eq("id", data.updated_by as string)
      .maybeSingle();
    updatedByEmail = (who?.display_username as string | null) ?? null;
  }

  const body: ModuleConfigResponse = {
    config: normalizeModuleConfig(data?.config),
    updatedAt: (data?.updated_at as string | null) ?? null,
    updatedByEmail,
  };
  return NextResponse.json(body);
}

/** PUT /api/configs/modules — replace the platform module config. */
export async function PUT(request: Request) {
  const auth = await assertConfigsAccess(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Unknown group/module keys are dropped rather than rejected, so a stale tab
  // posting a since-removed key cannot wedge the page.
  const config = normalizeModuleConfig(raw);

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { error } = await svc.from(MODULE_CONFIG_TABLE).upsert(
    {
      id: true,
      config,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "id" }
  );

  if (error) {
    if (new RegExp(MODULE_CONFIG_TABLE, "i").test(error.message ?? "")) {
      return NextResponse.json(
        { error: "Run migration 0066_platform_module_config.sql before using /configs." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clears this instance only; other instances pick the change up when their
  // 30s cache expires. Re-prime from the DB so the response reflects storage.
  invalidateModuleConfigCache();
  const fresh = await loadModuleConfig(svc);

  const res = NextResponse.json({ ok: true, config: fresh });
  // Middleware lives on the Edge and cannot see the invalidation above, so
  // hand the caller a marker that makes their very next navigation re-read the
  // config. Without it the sidebar would show a module the gate still blocks,
  // and clicking it would bounce to /inbox until the Edge cache expired.
  res.cookies.set(MODULE_CONFIG_STALE_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MODULE_CONFIG_STALE_MAX_AGE_SEC,
  });
  return res;
}
