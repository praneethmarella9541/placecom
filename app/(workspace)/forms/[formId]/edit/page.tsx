"use client";

import { useParams } from "next/navigation";
import { FormEditor } from "@/components/FormEditor";

export default function FormEditPage() {
  const params = useParams();
  const formId = typeof params.formId === "string" ? params.formId : "";
  if (!formId) return null;
  return <FormEditor formId={formId} />;
}
