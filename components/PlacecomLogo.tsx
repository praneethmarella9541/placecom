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
  const id = "nucleus-mark";

  return (
    <svg
      className={cn("shrink-0 drop-shadow-[0_2px_10px_rgba(99,91,255,0.28)]", className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        {/* Purple gradient for the nucleus core */}
        <radialGradient id={`${id}-core`} cx="42%" cy="38%" r="58%">
          <stop offset="0%" stopColor={inverted ? "#c4b5fd" : "#7c6fef"} />
          <stop offset="100%" stopColor={inverted ? "#7c3aed" : "#4f46e5"} />
        </radialGradient>
        {/* Blue arc gradient */}
        <linearGradient id={`${id}-arc`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      {/* Outer dashed orbit */}
      <circle
        cx="32" cy="32" r="30"
        stroke={inverted ? "rgba(255,255,255,0.35)" : "#c4b5fd"}
        strokeWidth="1.2"
        strokeDasharray="3.5 4"
        fill="none"
      />

      {/* Middle solid orbit */}
      <circle
        cx="32" cy="32" r="21"
        stroke={inverted ? "rgba(255,255,255,0.55)" : "#a5b4fc"}
        strokeWidth="1.4"
        strokeOpacity="0.75"
        fill="none"
      />

      {/* Inner orbit */}
      <circle
        cx="32" cy="32" r="13"
        stroke={inverted ? "rgba(255,255,255,0.7)" : "#818cf8"}
        strokeWidth="1.4"
        strokeOpacity="0.85"
        fill="none"
      />

      {/* Blue highlight arc on outer orbit (top-right quarter) */}
      <path
        d="M 32 2 A 30 30 0 0 1 58.5 18"
        stroke={`url(#${id}-arc)`}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Nucleus core with gradient */}
      <circle cx="32" cy="32" r="9" fill={`url(#${id}-core)`} />

      {/* Electron dot — top (on outer orbit) */}
      <circle cx="32" cy="2" r="2.4" fill="#38bdf8" />
      {/* Electron dot — left (on middle orbit) */}
      <circle cx="11" cy="43" r="2" fill="#38bdf8" />
      {/* Electron dot — bottom (on outer orbit) */}
      <circle cx="44" cy="59" r="2" fill="#60a5fa" />
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
