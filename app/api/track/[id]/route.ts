import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TRANSPARENT_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB" +
    "Nl7BcQAAAABJRU5ErkJggg==",
  "base64"
);

const PIXEL_HEADERS = {
  "Content-Type": "image/png",
  "Content-Length": String(TRANSPARENT_1X1_PNG.byteLength),
  "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function pixelResponse() {
  return new Response(TRANSPARENT_1X1_PNG, { status: 200, headers: PIXEL_HEADERS });
}

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  const trackingId = context.params.id;
  if (!trackingId) return pixelResponse();

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return pixelResponse();

    const supabase = createClient(url, key);

    const { data } = await supabase
      .from("email_tracking")
      .select("open_count")
      .eq("id", trackingId)
      .single();

    if (data) {
      const now = new Date().toISOString();
      await supabase
        .from("email_tracking")
        .update({
          opened: true,
          opened_at: now,
          open_count: (data.open_count || 0) + 1,
        })
        .eq("id", trackingId);
    }
  } catch {
    // Never fail — always return the pixel
  }

  return pixelResponse();
}
