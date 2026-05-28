"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { titleCase } from "@/lib/title-case";

/**
 * Opens a single spreadsheet using Google's own embedded Sheets editor.
 * The iframe gives users 100% of Sheets editing (formulas, formatting,
 * charts, collaboration) without us rebuilding the grid. Requires the
 * user to be signed into the same Google account in their browser — which
 * they are, via the app's Google OAuth.
 */
export default function SheetEditorPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  const editUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?embedded=true&rm=minimal`;
  const newTabUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] flex-col overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Toolbar */}
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

      {/* Embedded editor */}
      <div className="relative flex-1">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)]">
            <div className="flex flex-col items-center gap-3">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
              <p className="text-[13px] text-[var(--color-text-muted)]">
                {titleCase("Loading spreadsheet…")}
              </p>
            </div>
          </div>
        )}
        <iframe
          src={editUrl}
          title="Google Sheets editor"
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
