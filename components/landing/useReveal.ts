"use client";

import { useEffect, useRef, useState } from "react";

/** Sets visible to true once the element intersects the viewport (one-shot). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      // Positive margins expand the “viewport” so sections trigger a bit before they scroll into view.
      { threshold: 0.05, rootMargin: "100px 0px 180px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return { ref, visible };
}
