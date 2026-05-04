"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { IconDownload } from "@/components/Icons";

type Props = { className?: string };

export function ExportButton({ className }: Props) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/export-csv");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gmail-extractions.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn("btn-secondary", className)}
    >
      <IconDownload className="h-4 w-4" />
      {loading ? titleCase("Preparing…") : titleCase("Export CSV")}
    </button>
  );
}
