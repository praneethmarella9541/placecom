import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Wordmark color override (rarely needed — gradient is default) */
  wordmarkClassName?: string;
  /** True = white logo for on-indigo backgrounds */
  inverted?: boolean;
  /** Size of the mark (default 28) */
  size?: number;
};

/**
 * The Nucleus mark — atomic orbits around a central nucleus.
 * Inspired by the mobile app's brand mark.
 */
export function PlacecomMark({
  className,
  inverted,
  size = 28,
}: {
  className?: string;
  inverted?: boolean;
  size?: number;
}) {
  const stroke = inverted ? "#ffffff" : "var(--nucleus-bright)";
  const dashStroke = inverted ? "rgba(255,255,255,0.55)" : "var(--nucleus-mist)";
  const nucleus = inverted ? "#ffffff" : "var(--nucleus-bright)";
  const accent = inverted ? "rgba(255,255,255,0.85)" : "var(--nucleus-aurora)";

  return (
    <svg
      className={cn("shrink-0 drop-shadow-[0_2px_10px_rgba(79,70,229,0.25)]", className)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Outer dashed orbit */}
      <circle
        cx="16"
        cy="16"
        r="14"
        stroke={dashStroke}
        strokeWidth="1"
        strokeDasharray="2 3"
        fill="none"
      />
      {/* Middle solid orbit */}
      <circle
        cx="16"
        cy="16"
        r="10"
        stroke={stroke}
        strokeWidth="1.25"
        strokeOpacity="0.7"
        fill="none"
      />
      {/* Inner orbit */}
      <circle
        cx="16"
        cy="16"
        r="6.5"
        stroke={stroke}
        strokeWidth="1.25"
        strokeOpacity="0.85"
        fill="none"
      />
      {/* Nucleus core */}
      <circle cx="16" cy="16" r="3.5" fill={nucleus} />
      {/* Orbiting particles */}
      <circle cx="26" cy="6" r="1.4" fill={accent} />
      <circle cx="6" cy="22" r="1.2" fill={accent} />
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
          "font-display text-base font-bold leading-none tracking-tight md:text-lg md:font-extrabold",
          inverted ? "text-white" : "nucleus-wordmark",
          wordmarkClassName,
        )}
      >
        The Nucleus
      </span>
    </span>
  );
}
