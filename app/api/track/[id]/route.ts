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

/**
 * Below this gap between send and pixel fetch, it's not a human read. Confirmed
 * in prod: a Google Workspace recipient (thenucleus.in) consistently showed
 * "opened" 3–9 seconds after sending, every single time, regardless of whether
 * anyone had actually looked at it — Workspace's own security/link scanning
 * pre-fetches images in incoming mail immediately on delivery, as do most
 * corporate gateways (Mimecast, Proofpoint, O365 Safe Links). No sender-side
 * fix exists for that scanning — this just stops counting what it produces.
 * 15s comfortably clears automated prefetching while basically never excluding
 * a genuine read (even someone staring at their inbox when it lands takes
 * longer than that to actually open the message).
 */
const MIN_GENUINE_OPEN_DELAY_MS = 15_000;

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
      .select("open_count, sent_at")
      .eq("id", trackingId)
      .single();

    if (data) {
      const now = new Date();
      const sentAt = data.sent_at ? new Date(data.sent_at as string) : null;
      const looksAutomated = !!sentAt && now.getTime() - sentAt.getTime() < MIN_GENUINE_OPEN_DELAY_MS;
      if (!looksAutomated) {
        await supabase
          .from("email_tracking")
          .update({
            opened: true,
            opened_at: now.toISOString(),
            open_count: (data.open_count || 0) + 1,
          })
          .eq("id", trackingId);
      }
    }
  } catch {
    // Never fail — always return the pixel
  }

  return pixelResponse();
}
