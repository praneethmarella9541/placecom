"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { SequenceEditor } from "@/components/SequenceEditor";
import { titleCase } from "@/lib/title-case";

function SequencePageInner() {
  const params = useParams();
  const sequenceId = typeof params.sequenceId === "string" ? params.sequenceId : "";
  if (!sequenceId) return null;
  return <SequenceEditor sequenceId={sequenceId} />;
}

export default function SequenceDetailPage() {
  // SequenceEditor reads ?tab= via useSearchParams, which requires a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-[13px] text-[var(--color-text-faint)]">
          {titleCase("Loading sequence…")}
        </div>
      }
    >
      <SequencePageInner />
    </Suspense>
  );
}
