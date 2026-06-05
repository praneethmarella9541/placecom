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

  // Read directly — bypass the lib helper to rule out import issues
  const sidRaw   = process.env.EXOTEL_SID ?? process.env.EXOTEL_ACCOUNT_SID ?? "";
  const keyRaw   = process.env.EXOTEL_API_KEY ?? "";
  const tokenRaw = process.env.EXOTEL_API_TOKEN ?? "";

  console.log("[exotel-balance] env check — sid:", sidRaw ? `${sidRaw.slice(0,4)}…` : "EMPTY",
    "key:", keyRaw ? `${keyRaw.slice(0,4)}…` : "EMPTY",
    "token:", tokenRaw ? `${tokenRaw.slice(0,4)}…` : "EMPTY");

  const creds = getExotelCredentials();
  if (!creds) {
    return NextResponse.json({
      error: "Exotel not configured",
      debug: {
        hasSid:   !!sidRaw.trim(),
        hasKey:   !!keyRaw.trim(),
        hasToken: !!tokenRaw.trim(),
        // Show first 4 chars so you can verify the right value is there
        sidHint:   sidRaw   ? sidRaw.trim().slice(0, 4)   : null,
        keyHint:   keyRaw   ? keyRaw.trim().slice(0, 4)   : null,
        tokenHint: tokenRaw ? tokenRaw.trim().slice(0, 4) : null,
      },
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
        const text = await res.text().catch(() => "");
        console.log("[exotel-balance] API error:", res.status, text.slice(0, 300), "url:", url);
        if (res.status === 401 && hosts.length > 1) continue;
        return NextResponse.json({ error: `Exotel Balance API returned ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
      }

      const rawText = await res.text();
      console.log("[exotel-balance] raw response:", rawText.slice(0, 300));
      let json: { Account?: { AccountSid?: string; BalanceData?: { Balance?: string; Currency?: string; PricingPlan?: string; DateUpdated?: string } } };
      try { json = JSON.parse(rawText); } catch { return NextResponse.json({ error: `Non-JSON response: ${rawText.slice(0, 200)}` }, { status: 502 }); }


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
