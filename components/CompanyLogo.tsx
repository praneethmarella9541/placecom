"use client";

import { useState } from "react";
import { IconBuilding } from "@/components/Icons";
import { cn } from "@/lib/utils";

/**
 * Real company logo (from company_enrichment_cache — see lib/company-enrichment.ts)
 * when available, falling back to the generic building icon otherwise — including
 * when the image itself fails to load (e.g. a revoked token, logo.dev outage), not
 * just when logoUrl is null.
 */
export function CompanyLogo({ logoUrl, size = 20, className }: { logoUrl: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!logoUrl || failed) {
    return <IconBuilding className={cn("shrink-0 text-[var(--color-text-faint)]", className)} style={{ width: size, height: size }} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, per-domain, arbitrary logo.dev URLs; not worth next/image's config for this
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-sm object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}
