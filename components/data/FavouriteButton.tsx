"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";

/** Star or unstar a record or list for yourself. Starred items show under Favourites in the Data rail. */
export function FavouriteButton({ kind, id }: { kind: "record" | "list"; id: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void dataApi<{ favourites: { kind: string; id: string }[] }>("/api/data/favourites").then((r) => {
      if (live && r.ok) setOn(r.data.favourites.some((f) => f.kind === kind && f.id === id));
    });
    return () => {
      live = false;
    };
  }, [kind, id]);

  if (on === null) return null;
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? "Remove from favourites" : "Add to favourites"}
      title={on ? "Remove from favourites" : "Add to favourites"}
      onClick={async () => {
        setBusy(true);
        const r = await dataApi("/api/data/favourites", { method: "POST", body: { kind, id, on: !on } });
        setBusy(false);
        if (r.ok) setOn(!on);
      }}
      className="rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-copper)]"
    >
      <Star className={on ? "h-4 w-4 fill-[var(--color-copper)] text-[var(--color-copper)]" : "h-4 w-4"} />
    </button>
  );
}
