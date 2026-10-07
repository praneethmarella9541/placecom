import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  listDraftsPage,
  listThreadsPage,
  type MailFolder,
} from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const folderRaw = searchParams.get("folder") || "inbox";
  const folder: MailFolder =
    folderRaw === "sent"
      ? "sent"
      : folderRaw === "drafts"
        ? "drafts"
        : folderRaw === "trash"
          ? "trash"
          : folderRaw === "spam"
            ? "spam"
            : folderRaw === "allmail"
              ? "allmail"
              : "inbox";
  const pageToken = searchParams.get("pageToken") || undefined;
  const searchQuery = searchParams.get("search")?.trim() || undefined;
  const labelId = searchParams.get("labelId")?.trim() || undefined;
  const maxResults = Math.min(
    100,
    Math.max(5, parseInt(searchParams.get("maxResults") || "25", 10) || 25)
  );

  // Search only: send the list as soon as Gmail returns it, then each row as its
  // header resolves, instead of holding the response for every per-row fetch.
  if (searchParams.get("stream") === "1" && folder !== "drafts") {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        try {
          const page = await listThreadsPage(auth.accessToken, {
            folder,
            maxResults,
            pageToken,
            searchQuery,
            labelId,
            mailboxKey: auth.mailboxOwnerId,
            onSkeleton: (p) => send({ type: "list", ...p }),
            onRow: (row) => send({ type: "row", row }),
          });
          // Final, date-sorted order — the client swaps it in once everything has arrived.
          send({ type: "done", threads: page.threads, nextPageToken: page.nextPageToken });
        } catch (e) {
          const err = e as Error & { code?: string };
          send({
            type: "error",
            error:
              err.code === "UNAUTHORIZED"
                ? "Google token expired. Sign in again."
                : err.message || "Failed to list threads",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  try {
    const page =
      folder === "drafts"
        ? await listDraftsPage(auth.accessToken, {
            maxResults,
            pageToken,
            searchQuery,
            mailboxKey: auth.mailboxOwnerId,
          })
        : await listThreadsPage(auth.accessToken, {
            folder,
            maxResults,
            pageToken,
            searchQuery,
            labelId,
            mailboxKey: auth.mailboxOwnerId,
          });
    return NextResponse.json(
      { folder, threads: page.threads, nextPageToken: page.nextPageToken },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
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
    return NextResponse.json(
      { error: err.message || "Failed to list threads" },
      { status: 500 }
    );
  }
}
