"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try {
    localStorage.setItem("nucleus-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    /* ignore */
  }
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    applyTheme(next);
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)] text-[var(--color-text)] transition-all duration-200 hover:bg-[var(--color-surface-2)] hover:scale-110 hover:shadow-sm active:scale-90"
      aria-label="Toggle theme"
    >
      <span
        key={dark ? "sun" : "moon"}
        className="animate-scale-in"
        style={{ animationDuration: "0.18s" }}
      >
        {dark
          ? <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
          : <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
        }
      </span>
    </button>
  );
}
