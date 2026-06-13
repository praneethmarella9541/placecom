"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FormEditor } from "@/components/FormEditor";
import { titleCase } from "@/lib/title-case";

function FormEditPageInner() {
  const params = useParams();
  const formId = typeof params.formId === "string" ? params.formId : "";
  if (!formId) return null;
  return <FormEditor formId={formId} />;
}

export default function FormEditPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-[13px] text-[var(--color-text-faint)]">
          {titleCase("Loading form…")}
        </div>
      }
    >
      <FormEditPageInner />
    </Suspense>
  );
}
