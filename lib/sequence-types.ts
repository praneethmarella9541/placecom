/** Shared DTOs for the Sequences feature — safe to import from client components. */

export const SEQUENCE_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number];

export const ENROLLMENT_STATUSES = [
  "active",
  "paused",
  "completed",
  "replied",
  "bounced",
  "failed",
  "needs_attention",
  "removed",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const SEND_STATUSES = ["sending", "sent", "failed", "skipped"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export type SequenceStepKind = "email" | "wait";

export type SequenceStep = {
  id: string;
  stepOrder: number;
  kind: SequenceStepKind;
  subjectTemplate: string | null;
  bodyHtml: string | null;
  delayDays: number;
  delayHours: number;
};

/** A step as submitted by the editor — `id` is absent for newly added steps. */
export type SequenceStepInput = {
  id?: string;
  kind: SequenceStepKind;
  subjectTemplate?: string | null;
  bodyHtml?: string | null;
  delayDays?: number;
  delayHours?: number;
};

export type Sequence = {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  publishedAt: string | null;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  businessDaysOnly: boolean;
  dailySendLimit: number;
  threadEmails: boolean;
  includeSignature: boolean;
  signatureHtml: string | null;
  trackOpens: boolean;
  exitOnReply: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnrollmentCounts = Record<EnrollmentStatus, number>;

export type SequenceListItem = Pick<
  Sequence,
  "id" | "name" | "description" | "status" | "publishedAt" | "updatedAt"
> & {
  emailStepCount: number;
  recipientCount: number;
  counts: EnrollmentCounts;
};

export type SequenceEnrollment = {
  id: string;
  email: string;
  displayName: string | null;
  status: EnrollmentStatus;
  currentStepOrder: number;
  nextRunAt: string | null;
  firstSentAt: string | null;
  lastSentAt: string | null;
  repliedAt: string | null;
  lastError: string | null;
  mergeFields: Record<string, string>;
  /** Comma-separated extra recipients cc'd on every step sent to this enrollment. */
  cc: string | null;
};

export type SequenceSend = {
  id: string;
  stepId: string | null;
  status: SendStatus;
  toEmail: string;
  subject: string | null;
  gmailThreadId: string | null;
  error: string | null;
  createdAt: string;
};

export function emptyEnrollmentCounts(): EnrollmentCounts {
  return {
    active: 0,
    paused: 0,
    completed: 0,
    replied: 0,
    bounced: 0,
    failed: 0,
    needs_attention: 0,
    removed: 0,
  };
}

/** Recipients in these states are done — they will never receive another step. */
export const TERMINAL_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  "completed",
  "replied",
  "bounced",
  "failed",
  "removed",
];

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Failed",
  needs_attention: "Needs attention",
  removed: "Removed",
};

export const SEQUENCE_STATUS_LABELS: Record<SequenceStatus, string> = {
  draft: "Draft",
  active: "Enabled",
  paused: "Paused",
  archived: "Archived",
};
