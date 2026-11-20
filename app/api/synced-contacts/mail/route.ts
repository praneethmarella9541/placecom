import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isByomEnabled } from "@/lib/mailbox-context";
import { orgOwnerIdForUser } from "@/lib/contact-source-flags";
import { loadContactMail, readableMailboxes } from "@/lib/contact-mail";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/synced-contacts/mail?email=…[&refresh=1] — the Mail tab of a contact (BYOM).
 *
 * Called only when the tab is opened. Thread headers from the cache first, Gmail for a mailbox
 * that has none recent. Returns mail from exactly the mailboxes the caller may read: their own
 * individual mailbox and the common one (if they have access to it). Another member's
 * individual mailbox is never read, cached or returned — see lib/contact-mail.ts.
 */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

  const svc = createServiceSupabase();
  if (!(await isByomEnabled(svc))) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const authed = await getAuthedRequest(request);
  const orgOwnerId = await orgOwnerIdForUser(user.id);
  if (!authed || !orgOwnerId) return NextResponse.json({ error: "Your account is not on a team." }, { status: 403 });

  // The Mail tab spans every mailbox the caller may read, whichever one the switcher is on.
  const readable = await readableMailboxes(svc, user.id, orgOwnerId);
  if (!readable.ok) return NextResponse.json({ error: readable.error }, { status: readable.status });

  try {
    const result = await loadContactMail({
      userClient: supabase,
      authed,
      orgOwnerId,
      readable: readable.options,
      keys: [email],
      refresh: url.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({
      ...result,
      mailboxes: readable.options.map((o) => ({ id: o.id, type: o.type })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load mail";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
