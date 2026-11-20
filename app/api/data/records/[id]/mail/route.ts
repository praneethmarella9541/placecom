import { NextResponse } from "next/server";
import { withRecord } from "@/lib/data-model/route-helpers";
import { getUserOr401 } from "@/lib/request-auth";
import { getAuthedRequest } from "@/lib/api-auth";
import { isByomEnabled } from "@/lib/mailbox-context";
import { loadContactMail, readableMailboxes } from "@/lib/contact-mail";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/data/records/[id]/mail[?refresh=1] — the Mail tab of a Person or Company in the Data
 * tab (BYOM). Same engine as the Contacts page (lib/contact-mail.ts): thread headers from the
 * cache first, Gmail only for a mailbox with nothing recent, and only the caller's own individual
 * mailbox plus the common mailbox — never another member's. A Person is looked up by their email
 * addresses, a Company by its domains.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;
  const { record, object } = found;

  if (!(await isByomEnabled(svc))) return NextResponse.json({ error: "Not available" }, { status: 404 });

  const list = (slug: string) => {
    const v = record.values[slug];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === "string");
  };
  let keys: string[] = [];
  if (object.slug === "people") keys = list("email_addresses").map((e) => e.trim().toLowerCase());
  else if (object.slug === "companies") keys = list("domains").map((d) => `@${d.trim().toLowerCase().replace(/^@/, "")}`);
  keys = keys.filter((k) => k.length > 1).slice(0, 5);
  if (keys.length === 0) return NextResponse.json({ items: [], fromCache: true, warnings: [], reason: "no_address" });

  const { supabase } = await getUserOr401(request);
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const readable = await readableMailboxes(svc, userId, orgOwnerId);
  if (!readable.ok) return NextResponse.json({ error: readable.error }, { status: readable.status });

  try {
    const result = await loadContactMail({
      userClient: supabase,
      authed,
      orgOwnerId,
      readable: readable.options,
      keys,
      refresh: new URL(request.url).searchParams.get("refresh") === "1",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load mail" }, { status: 500 });
  }
}
