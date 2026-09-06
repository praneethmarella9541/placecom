import type { Metadata } from "next";
import Link from "next/link";
import { PlacecomMark } from "@/components/PlacecomLogo";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { PRIVACY_POLICY_MARKDOWN } from "./content";

// Public legal page — not gated behind auth. middleware.ts only acts on a
// signed-in request (it returns early when there's no user), and this path
// matches no entry in lib/feature-access.ts, so it's unaffected by the
// domain-feature-cap redirect either way; no middleware change needed.
export const metadata: Metadata = {
  title: "Privacy Policy — The Nucleus",
  description: "How Prachemur Labs LLP collects, uses, stores, and protects information in The Nucleus.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-2)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <PlacecomMark size={24} />
            <span className="text-[15px] font-semibold text-[var(--color-text)]">The Nucleus</span>
          </Link>
          <Link
            href="/"
            className="text-[13px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 sm:px-10 sm:py-10">
          <SimpleMarkdown markdown={PRIVACY_POLICY_MARKDOWN} />
        </article>
      </main>
    </div>
  );
}
