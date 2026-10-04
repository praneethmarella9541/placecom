import { NextResponse } from "next/server";
import { listWhatsAppFeatures } from "@/lib/whatsapp-capabilities";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ features: listWhatsAppFeatures() });
}
