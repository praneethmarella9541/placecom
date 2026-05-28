"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { IconForward, IconReply, IconReplyAll } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type ThreadActionsMenuProps = {
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  className?: string;
};

/** Gmail-style ⋮ menu with Reply, Reply all, and Forward. */
export function ThreadActionsMenu({
  onReply,
  onReplyAll,
  onForward,
  className,
}: ThreadActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t && !t.closest("[data-thread-actions-menu]")) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)} data-thread-actions-menu>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#444746] hover:bg-[#e8eaed]"
        aria-label={titleCase("More actions")}
        title={titleCase("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5" strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[#dadce0] bg-white py-1 shadow-[0_2px_6px_rgba(60,64,67,0.15),0_8px_24px_rgba(60,64,67,0.15)]"
          role="menu"
        >
          <MenuItem
            icon={<IconReply className="h-[18px] w-[18px] text-[#5f6368]" />}
            label={titleCase("Reply")}
            onClick={() => run(onReply)}
          />
          <MenuItem
            icon={<IconReplyAll className="h-[18px] w-[18px] text-[#5f6368]" />}
            label={titleCase("Reply all")}
            onClick={() => run(onReplyAll)}
          />
          <MenuItem
            icon={<IconForward className="h-[18px] w-[18px] text-[#5f6368]" />}
            label={titleCase("Forward")}
            onClick={() => run(onForward)}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-[#202124] hover:bg-[#f1f3f4]"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
