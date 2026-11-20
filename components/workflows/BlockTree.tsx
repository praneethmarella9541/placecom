"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { BLOCK_GROUPS, BLOCK_LABELS, type Slot } from "@/lib/workflows/graph";
import type { BlockType, Graph, Trigger } from "@/lib/workflows/types";
import { blockTitle, describeBlock, describeTrigger, type WorkflowMeta } from "@/lib/workflows/describe";

export type StepStatus = "succeeded" | "failed" | "stopped" | "pending";

type Props = {
  graph: Graph;
  trigger: Trigger;
  meta: WorkflowMeta | null;
  /** A block key, "trigger", or null. */
  selected: string | null;
  onSelect: (key: string | "trigger") => void;
  /** Present in the builder; absent in the run viewer. */
  onAdd?: (at: Slot, type: BlockType) => void;
  /** Run viewer: what happened to each block. */
  statuses?: Record<string, StepStatus>;
};

/** The workflow as a tree read top to bottom: the trigger, then blocks, with if/else paths side by side. */
export function BlockTree(props: Props) {
  const { graph, trigger, meta, selected, onSelect, onAdd, statuses } = props;

  const Card = ({ id, title, summary, tone }: { id: string; title: string; summary: string; tone?: "trigger" }) => {
    const status = statuses?.[id];
    const isSel = selected === id;
    return (
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={isSel}
        className={cn(
          "relative w-[240px] rounded-lg border px-3 py-2 text-left transition-colors",
          tone === "trigger" ? "border-[var(--color-success)] bg-[var(--color-success-light)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]",
          isSel && "ring-2 ring-[var(--color-copper)]",
          status === "failed" && "border-[var(--color-danger)] bg-[var(--color-danger-light)]",
          status === "pending" && "opacity-60"
        )}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          {tone === "trigger" && <Zap className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-hidden />}
          <span className="truncate">{title}</span>
          {status === "succeeded" && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-label="Ran" />}
          {status === "stopped" && <span className="ml-auto text-[11px] font-medium text-[var(--color-text-faint)]">stopped here</span>}
          {status === "failed" && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" aria-label="Failed" />}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{summary}</span>
      </button>
    );
  };

  const Line = () => <span aria-hidden className="block h-4 w-px bg-[var(--color-border-strong)]" />;

  const Branch = ({ parent, slot }: { parent: string | null; slot: "next" | "yes" | "no" }): React.ReactElement => {
    const key = parent === null ? graph.start : (graph.blocks[parent]?.[slot] ?? null);
    const block = key ? graph.blocks[key] : null;
    return (
      <>
        {onAdd ? <AddSlot onPick={(type) => onAdd({ parent, slot }, type)} /> : block ? <Line /> : null}
        {block && (
          <>
            <Card id={block.key} title={blockTitle(block)} summary={describeBlock(block, meta)} />
            {block.type === "if_else" ? (
              <>
                <Line />
                <div className="flex items-start gap-6">
                  {(["yes", "no"] as const).map((s) => (
                    <div key={s} className="flex flex-col items-center">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", s === "yes" ? "border-[var(--color-success)] text-[var(--color-success)]" : "border-[var(--color-border-strong)] text-[var(--color-text-muted)]")}>{s}</span>
                      <Branch parent={block.key} slot={s} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Branch parent={block.key} slot="next" />
            )}
          </>
        )}
      </>
    );
  };

  return (
    <div className="flex min-w-max flex-col items-center py-2" role="tree" aria-label="Workflow">
      <Card id="trigger" tone="trigger" title="Trigger" summary={describeTrigger(trigger, meta)} />
      <Branch parent={null} slot="next" />
    </div>
  );
}

/** A "+" on the line between blocks. Opens a menu of block types. */
function AddSlot({ onPick }: { onPick: (type: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex flex-col items-center">
      <span aria-hidden className="block h-3 w-px bg-[var(--color-border-strong)]" />
      <button type="button" aria-label="Add a block here" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-copper)] hover:text-[var(--color-copper)]">
        <Plus className="h-3 w-3" />
      </button>
      <span aria-hidden className="block h-3 w-px bg-[var(--color-border-strong)]" />
      {open && (
        <div role="menu" aria-label="Add a block" className="absolute left-1/2 top-7 z-30 w-[230px] -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-lg)]">
          {BLOCK_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{g.label}</p>
              {g.types.map((t) => (
                <button key={t} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(t); }} className="block w-full rounded px-2 py-1 text-left text-[13px] hover:bg-[var(--color-surface-2)]">
                  {BLOCK_LABELS[t]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
