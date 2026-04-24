import { NextResponse } from "next/server";
import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  collectMessageIdsForFetch,
  fetchEmailsWithDetails,
  fetchGmailMessagesByIds,
  type GmailLabelFilter,
} from "@/lib/gmail";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  accessToken?: string;
  maxEmails?: number | "all" | string;
  labelFilter?: GmailLabelFilter;
  /** When true, respond with NDJSON lines for progress + final emails (see dashboard). */
  stream?: boolean;
};

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accessToken = body.accessToken?.trim();
  if (!accessToken) {
    return NextResponse.json(
      { error: "accessToken is required" },
      { status: 400 }
    );
  }

  const rawMaxEmails = body.maxEmails ?? 50;
  let maxEmails: number | "all" = 50;
  if (rawMaxEmails === "all") {
    maxEmails = "all";
  } else if (typeof rawMaxEmails === "number" && Number.isFinite(rawMaxEmails)) {
    maxEmails = Math.max(1, Math.floor(rawMaxEmails));
  } else if (typeof rawMaxEmails === "string") {
    const parsed = parseInt(rawMaxEmails, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      maxEmails = parsed;
    }
  }
  const labelFilter: GmailLabelFilter = body.labelFilter ?? "inbox";

  if (body.stream) {
    const encoder = new TextEncoder();
    const out = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };
        try {
          const ids = await collectMessageIdsForFetch(accessToken, {
            maxEmails,
            labelFilter,
            onListProgress: (listed) => send({ type: "listing", listed }),
          });
          send({ type: "list", total: ids.length });
          const emails = await fetchGmailMessagesByIds(accessToken, ids, {
            onProgress: (done, total) => send({ type: "bodies", done, total }),
          });
          send({ type: "complete", emails });
        } catch (e) {
          const err = e as Error & { code?: string };
          if (err.code === "UNAUTHORIZED") {
            send({
              type: "error",
              code: "UNAUTHORIZED",
              message:
                "Your Google session expired. Please sign out and connect Gmail again.",
            });
          } else if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
            send({
              type: "error",
              code: GMAIL_INSUFFICIENT_SCOPE,
              message: err.message,
            });
          } else {
            send({
              type: "error",
              message:
                e instanceof Error && e.message
                  ? e.message
                  : describeUpstreamFetchError(e, "Gmail API"),
            });
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(out, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const emails = await fetchEmailsWithDetails(accessToken, {
      maxEmails,
      labelFilter,
    });

    return NextResponse.json({ emails });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message:
            "Your Google session expired. Please sign out and connect Gmail again.",
        },
        { status: 401 }
      );
    }
    if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
      return NextResponse.json(
        { error: GMAIL_INSUFFICIENT_SCOPE, message: err.message },
        { status: 403 }
      );
    }
    console.error(e);
    const message =
      e instanceof Error && e.message
        ? e.message
        : describeUpstreamFetchError(e, "Gmail API");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
