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
    return NextResponse.json({ error: "Exotel not configured — set EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN" }, { status: 503 });
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
        const text = await res.text().catch(() => "");
        if (res.status === 401 && hosts.length > 1) continue;
        return NextResponse.json({ error: `Exotel Balance API returned ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
      }

      const json = (await res.json()) as Record<string, unknown>;

      // Exotel actual format: {"Balance":{"Amount":3863.004267}}
      // Documented format:    {"Account":{"BalanceData":{"Balance":"...","Currency":"INR",...}}}
      const direct = json.Balance as { Amount?: number } | undefined;
      const nested = (json.Account as { BalanceData?: { Balance?: string; Currency?: string; PricingPlan?: string; DateUpdated?: string } } | undefined)?.BalanceData;
      const amount = direct?.Amount ?? (nested?.Balance ? parseFloat(nested.Balance) : null);

      return NextResponse.json({
        balance: amount,
        currency: nested?.Currency ?? "INR",
        pricingPlan: nested?.PricingPlan ?? null,
        dateUpdated: nested?.DateUpdated ?? null,
        accountSid: (json.Account as { AccountSid?: string } | undefined)?.AccountSid ?? creds.sid,
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
