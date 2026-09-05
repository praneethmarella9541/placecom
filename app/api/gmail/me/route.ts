import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { fetchGmail, GMAIL_COST } from "@/lib/gmail-quota";

export const runtime = "nodejs";

/**
 * Returns the Gmail address for the signed-in user's mailbox.
 * Used by the client to exclude the user's own address from Reply All recipients.
 */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // gmailAddress comes from the stored mailbox row (gmail_address column).
  // If not available there, fall back to a Gmail profile API call.
  if (auth.gmailAddress) {
    return NextResponse.json(
      { email: auth.gmailAddress },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  }

  // Fallback: hit the Gmail profile endpoint.
  try {
    const res = await fetchGmail(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
      { mailboxKey: auth.mailboxOwnerId, cost: GMAIL_COST.getProfile }
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch Gmail profile" }, { status: 502 });
    }
    const data = (await res.json()) as { emailAddress?: string };
    return NextResponse.json(
      { email: data.emailAddress ?? "" },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: err.message || "Failed to fetch Gmail profile" }, { status: 500 });
  }
}
