"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { SheetEditor } from "@/components/SheetEditor";

/**
 * Native spreadsheet editor backed by the Google Sheets API using the
 * app's server-side token (the same one Gmail/Drive use). We do NOT iframe
 * docs.google.com — that requires the user's browser to be logged into the
 * Google account, which our shared-mailbox model can't guarantee. Instead
 * we render cells, formatting, and tabs ourselves and write edits back via
 * the API.
 */
export default function SheetEditorPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const newTabUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] flex-col overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => router.push("/sheets")}
          className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-[13px]"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          {titleCase("Back to Sheets")}
        </button>
        <a
          href={newTabUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex h-9 items-center gap-2 px-3 text-[13px]"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={2} />
          {titleCase("Open in Google Sheets")}
        </a>
      </div>

      {/* Native editor */}
      <div className="flex-1 overflow-hidden">
        <SheetEditor spreadsheetId={id} />
      </div>
    </div>
  );
}
