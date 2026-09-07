import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { renderLegalMarkdown } from "@/lib/legal-markdown";

export const metadata: Metadata = {
  title: "Delete Your Account | The Nucleus",
  description: "How to request deletion of your The Nucleus account and associated data.",
};

export default function AccountDeletionPage() {
  const content = fs.readFileSync(path.join(process.cwd(), "ACCOUNT_DELETION.md"), "utf8");

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-8 text-[var(--color-text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <a
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--color-copper)] transition-colors hover:text-[var(--color-copper-hover)]"
        >
          <span aria-hidden="true">&larr;</span> The Nucleus
        </a>

        <article
          className="privacy-policy surface-card overflow-hidden rounded-[var(--radius-xl)] p-5 sm:p-8 lg:p-10"
          dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(content) }}
        />
      </div>
    </main>
  );
}
