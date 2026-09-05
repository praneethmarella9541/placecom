"use client";

import { useState } from "react";
import { IconBuilding } from "@/components/Icons";
import { cn } from "@/lib/utils";

/**
 * Real company logo (from company_enrichment_cache — see lib/company-enrichment.ts)
 * when available, falling back to the generic building icon otherwise — including
 * when the image itself fails to load (e.g. a revoked token, logo.dev outage), not
 * just when logoUrl is null.
 *
 * `fill` renders a self-contained circular badge: the logo sits on a white ground
 * that fills the whole circle (object-contain keeps wordmarks intact), and only
 * the icon fallback keeps the muted grey circle.
 */
export function CompanyLogo({
  logoUrl,
  size = 20,
  className,
  fill = false,
}: {
  logoUrl: string | null;
  size?: number;
  className?: string;
  fill?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const hasLogo = Boolean(logoUrl) && !failed;

  if (fill) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          hasLogo
            ? "bg-white ring-1 ring-[var(--color-border)]"
            : "bg-[var(--color-surface-offset)]",
          className
        )}
        style={{ width: size, height: size }}
      >
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, per-domain, arbitrary logo.dev URLs; not worth next/image's config for this
          <img
            src={logoUrl as string}
            alt=""
            className="h-full w-full object-contain p-[15%]"
            onError={() => setFailed(true)}
          />
        ) : (
          <IconBuilding
            className="text-[var(--color-text-faint)]"
            style={{ width: size * 0.5, height: size * 0.5 }}
          />
        )}
      </span>
    );
  }

  if (!hasLogo) {
    return (
      <IconBuilding
        className={cn("shrink-0 text-[var(--color-text-faint)]", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, per-domain, arbitrary logo.dev URLs; not worth next/image's config for this
    <img
      src={logoUrl as string}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-sm object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}
