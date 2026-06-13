import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertAdmin() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 as const };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return { error: "Admin only", status: 403 as const };
  return { ok: true as const };
}

export type OpenAIBalance = {
  balance: number | null;
  currency: string;
  totalGranted: number | null;
  dateUpdated: string | null;
  error?: string;
  debug?: { hasKey: boolean };
};

export async function GET() {
  const auth = await assertAdmin();
  if (!("ok" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "OpenAI API key not configured — set OPENAI_API_KEY",
      debug: { hasKey: false },
    } as OpenAIBalance, { status: 503 });
  }

  try {
    // OpenAI doesn't officially document a public API for checking balance via API key,
    // but the dashboard endpoint often works.
    const res = await fetch("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const msg = text.slice(0, 200);
      
      if (res.status === 401) {
        return NextResponse.json({
          error: "Invalid or unauthorized OpenAI API key",
          debug: { hasKey: true },
        } as OpenAIBalance, { status: 401 });
      }
      if (res.status === 403) {
        return NextResponse.json({
          error: "OpenAI restricts programmatic balance checks for this key type.",
          debug: { hasKey: true },
        } as OpenAIBalance, { status: 403 });
      }
      
      return NextResponse.json({
        error: `OpenAI returned ${res.status}: ${msg}`,
        debug: { hasKey: true },
      } as OpenAIBalance, { status: 502 });
    }

    const json = (await res.json()) as {
      total_granted?: number;
      total_used?: number;
      total_available?: number;
    };

    return NextResponse.json({
      balance: json.total_available ?? 0,
      currency: "USD",
      totalGranted: json.total_granted ?? 0,
      dateUpdated: new Date().toISOString(),
      debug: { hasKey: true },
    } as OpenAIBalance, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Failed to fetch OpenAI balance",
      debug: { hasKey: true },
    } as OpenAIBalance, { status: 502 });
  }
}
