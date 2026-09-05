import { cn } from "@/lib/utils";
import {
  ENROLLMENT_STATUS_LABELS,
  SEQUENCE_STATUS_LABELS,
  type EnrollmentStatus,
  type SequenceStatus,
} from "@/lib/sequence-types";

const SEQUENCE_TONES: Record<SequenceStatus, string> = {
  draft: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  paused: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  archived: "bg-[var(--color-surface-2)] text-[var(--color-text-faint)]",
};

const ENROLLMENT_TONES: Record<EnrollmentStatus, string> = {
  active: "bg-[var(--color-copper-tint)] text-[var(--color-copper)]",
  paused: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  replied: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  bounced: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  failed: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  needs_attention: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  removed: "bg-[var(--color-surface-2)] text-[var(--color-text-faint)]",
};

const BASE = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold";

export function SequenceStatusPill({ status }: { status: SequenceStatus }) {
  return <span className={cn(BASE, SEQUENCE_TONES[status])}>{SEQUENCE_STATUS_LABELS[status]}</span>;
}

export function EnrollmentStatusPill({ status }: { status: EnrollmentStatus }) {
  return (
    <span className={cn(BASE, ENROLLMENT_TONES[status])}>{ENROLLMENT_STATUS_LABELS[status]}</span>
  );
}
