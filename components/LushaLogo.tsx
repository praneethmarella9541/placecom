/* eslint-disable @next/next/no-img-element -- tiny static brand assets from /public */

/** Lusha's square mark, for buttons and headers. Sized by `className` (default 16px). */
export function LushaMark({ className = "h-4 w-4" }: { className?: string }) {
  return <img src="/integrations/lusha-icon.webp" alt="" aria-hidden="true" className={`${className} shrink-0 rounded-[3px] object-contain`} />;
}

/** Lusha's full wordmark. Dark artwork, so it's meant for light backgrounds. */
export function LushaWordmark({ className = "h-6" }: { className?: string }) {
  return <img src="/integrations/lusha-logo.svg" alt="Lusha" className={`${className} w-auto`} />;
}
