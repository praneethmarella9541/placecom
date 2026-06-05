import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getExotelCredentials, getExotelApiHostCandidates, getExotelBasicAuthHeader } from "@/lib/exotel-config";

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

export async function GET() {
  const auth = await assertAdmin();
  if (!("ok" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const creds = getExotelCredentials();
  if (!creds) {
    // Debug: show which vars are missing (values hidden)
    const sid = process.env.EXOTEL_SID?.trim() || process.env.EXOTEL_ACCOUNT_SID?.trim();
    const key = process.env.EXOTEL_API_KEY?.trim();
    const token = process.env.EXOTEL_API_TOKEN?.trim();
    const missing = [
      !sid && "EXOTEL_SID",
      !key && "EXOTEL_API_KEY",
      !token && "EXOTEL_API_TOKEN",
    ].filter(Boolean).join(", ");
    return NextResponse.json({
      error: `Exotel not configured — missing: ${missing || "unknown"}`,
      debug: { hasSid: !!sid, hasKey: !!key, hasToken: !!token },
    }, { status: 503 });
  }

  const authorization = getExotelBasicAuthHeader(creds);
  const hosts = getExotelApiHostCandidates();

  for (const host of hosts) {
    const url = `https://${host}/v1/Accounts/${encodeURIComponent(creds.sid)}/Balance.json`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: authorization },
        cache: "no-store",
      });

      if (!res.ok) {
        if (res.status === 401 && hosts.length > 1) continue; // try other region
        const text = await res.text().catch(() => "");
        return NextResponse.json({ error: `Exotel Balance API returned ${res.status}: ${text}` }, { status: 502 });
      }

      const json = (await res.json()) as {
        Account?: {
          AccountSid?: string;
          BalanceData?: {
            Balance?: string;
            Currency?: string;
            PricingPlan?: string;
            DateUpdated?: string;
          };
        };
      };

      const bd = json.Account?.BalanceData;
      return NextResponse.json({
        balance: bd?.Balance ? parseFloat(bd.Balance) : null,
        currency: bd?.Currency ?? "INR",
        pricingPlan: bd?.PricingPlan ?? null,
        dateUpdated: bd?.DateUpdated ?? null,
        accountSid: json.Account?.AccountSid ?? creds.sid,
      }, {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    } catch (e) {
      if (hosts.indexOf(host) < hosts.length - 1) continue;
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to fetch balance" }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Could not reach Exotel API" }, { status: 502 });
}
