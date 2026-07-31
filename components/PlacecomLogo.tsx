import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Wordmark color override (rarely needed — ink is default) */
  wordmarkClassName?: string;
  /** True = white logo for on-dark backgrounds */
  inverted?: boolean;
  /** Size of the mark (default 26) */
  size?: number;
};

/**
 * The Nucleus mark — three intersecting orbital rings around a solid core.
 */
export function PlacecomMark({
  className,
  inverted,
  size = 26,
}: {
  className?: string;
  inverted?: boolean;
  size?: number;
}) {
  const stroke = inverted ? "#FFFFFF" : "var(--color-copper, #C45C1A)";

  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="32" cy="32" r="27" stroke={stroke} strokeWidth="2.2" />
      <ellipse cx="32" cy="32" rx="27" ry="11" stroke={stroke} strokeWidth="2.2" transform="rotate(60 32 32)" />
      <ellipse cx="32" cy="32" rx="27" ry="11" stroke={stroke} strokeWidth="2.2" transform="rotate(-60 32 32)" />
      <circle cx="32" cy="32" r="6" fill={stroke} />
    </svg>
  );
}

export function PlacecomLogo({ className, wordmarkClassName, inverted, size }: LogoProps) {
  return (
    <span className={cn("group inline-flex items-center gap-2.5 transition-opacity duration-150 hover:opacity-85", className)}>
      <PlacecomMark
        inverted={inverted}
        size={size}
        className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12"
      />
      <span
        className={cn(
          "font-display text-[15px] font-bold leading-none tracking-[-0.01em]",
          inverted ? "text-white" : "text-[var(--color-text)]",
          wordmarkClassName,
        )}
      >
        The Nucleus
      </span>
    </span>
  );
}
