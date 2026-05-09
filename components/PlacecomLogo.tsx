import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Wordmark color */
  wordmarkClassName?: string;
  /** True = white logo for on-teal backgrounds */
  inverted?: boolean;
};

export function PlacecomMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill={inverted ? "#ffffff" : "#0d7c78"} />
      <path
        d="M9 10h6c3.3 0 5 1.7 5 4.2 0 2.2-1.2 3.6-3.2 4l3.7 5.8H17l-3.2-5.2H12v5.2H9V10zm3 6.2h2.8c1.4 0 2.2-.6 2.2-1.8 0-1.2-.8-1.8-2.3-1.8H12v3.6z"
        fill={inverted ? "#0d7c78" : "#ffffff"}
      />
    </svg>
  );
}

export function PlacecomLogo({ className, wordmarkClassName, inverted }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <PlacecomMark inverted={inverted} />
      <span
        className={cn(
          "font-display text-lg font-extrabold leading-none tracking-tight",
          inverted ? "text-white" : "text-[var(--color-primary)]",
          wordmarkClassName,
        )}
      >
        Placecom
      </span>
    </span>
  );
}
