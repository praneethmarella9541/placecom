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

/**
 * `sequenceActive` guards against the one combination the raw status lies
 * about: an enrollment sits at "active" while the sequence itself is disabled.
 * The scheduler's claim query requires `s.status = 'active'` (see
 * 0036_sequences.sql), so nothing is going out for that person — calling them
 * "Active" would promise sending that can't happen. They're still stored as
 * active, and that matters: re-enabling the sequence resumes exactly these
 * people, while anyone paused on their own row stays put. So it's only the
 * label that changes, never the status.
 */
export function EnrollmentStatusPill({
  status,
  sequenceActive = true,
}: {
  status: EnrollmentStatus;
  sequenceActive?: boolean;
}) {
  if (status === "active" && !sequenceActive) {
    return (
      <span
        className={cn(BASE, "bg-amber-500/10 text-amber-600 dark:text-amber-400")}
        title="The sequence is disabled — this recipient resumes here once you enable it."
      >
        On hold
      </span>
    );
  }
  return (
    <span className={cn(BASE, ENROLLMENT_TONES[status])}>{ENROLLMENT_STATUS_LABELS[status]}</span>
  );
}
