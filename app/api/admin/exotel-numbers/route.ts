import { NextResponse } from "next/server";
import { assertAdminUserId } from "@/lib/admin-auth";
import { getAvailableExotelNumbers } from "@/lib/admin-exotel-numbers";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const availableOnly = searchParams.get("available") === "1";
  const forMemberId = searchParams.get("forMemberId")?.trim() || undefined;

  try {
    const numbers = availableOnly
      ? await getAvailableExotelNumbers(auth.userId, { forMemberId })
      : await getExotelVirtualNumbers();
    return NextResponse.json(
      {
        numbers,
        source: availableOnly ? "available" : numbers.length > 0 ? "exotel" : "none",
      },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Exotel numbers" },
      { status: 502 },
    );
  }
}
