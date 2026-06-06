import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  fetchExotelWabaIds,
  fetchExotelWhatsAppTemplatesResolved,
} from "@/lib/exotel-whatsapp-templates";
import { loadWhatsAppTemplatesFromConfig } from "@/lib/whatsapp-template";
import { getWhatsAppTemplatesResolved } from "@/lib/whatsapp-template-resolve";

export const runtime = "nodejs";

/** Debug: list config templates, resolved names, and raw Exotel templates. */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const wabaId = process.env.EXOTEL_WABA_ID?.trim() ?? "";
  const config = loadWhatsAppTemplatesFromConfig();
  const resolved = await getWhatsAppTemplatesResolved();
  const wabaIds = wabaId ? [wabaId] : await fetchExotelWabaIds();
  const exotel = await fetchExotelWhatsAppTemplatesResolved();

  return NextResponse.json({
    wabaId: wabaId || null,
    wabaIds,
    config,
    resolved,
    exotel,
    hint: "resolved.name should match exotel.name for each template (auto-synced from Exotel when credentials are set)",
  });
}
