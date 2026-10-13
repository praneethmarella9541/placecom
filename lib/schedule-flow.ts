import { describeDelay, isValidTimeZone, zonedTimeToUtc } from "@/lib/sequence-schedule";

/**
 * State behind the composer's "Scheduling" toggle (mass sending only): a flow of one email plus
 * optional follow-ups that the server sends on a schedule, even with the tab closed. The first
 * email is the composer's own subject and body; everything else lives here.
 */

export const MAX_FOLLOW_UPS = 10;

export type FollowUpDraft = {
  /** Local key only — the server numbers steps itself. */
  id: string;
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  /** Only used when follow-ups are not threaded; a threaded follow-up replies to the first email. */
  subject: string;
  bodyHtml: string;
};

export type ScheduleFlowState = {
  startMode: "now" | "later";
  /** Wall-clock "YYYY-MM-DDTHH:mm" in `timezone` (date and time are edited separately). */
  startLocal: string;
  followUps: FollowUpDraft[];
  exitOnReply: boolean;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  businessDaysOnly: boolean;
  dailyLimit: number;
  threadEmails: boolean;
};

/** The platform's working zone (Asia/Calcutta is the older name for the same zone). */
export const DEFAULT_SCHEDULE_TIMEZONE = "Asia/Kolkata";

export function defaultScheduleFlow(): ScheduleFlowState {
  return {
    startMode: "now",
    startLocal: "",
    followUps: [],
    exitOnReply: true,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    windowStart: "09:00",
    windowEnd: "17:00",
    businessDaysOnly: true,
    dailyLimit: 200,
    threadEmails: true,
  };
}

export function newFollowUp(): FollowUpDraft {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()),
    delayDays: 3,
    delayHours: 0,
    delayMinutes: 0,
    subject: "",
    bodyHtml: "",
  };
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** The chosen start as an instant, or null for "as soon as possible" / an unreadable value. */
export function scheduleStartDate(state: ScheduleFlowState): Date | null {
  if (state.startMode !== "later") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(state.startLocal);
  if (!m || !isValidTimeZone(state.timezone)) return null;
  const date = zonedTimeToUtc(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) },
    state.timezone,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A message the user can act on, or null when the flow is ready to schedule. */
export function validateScheduleFlow(state: ScheduleFlowState, now = new Date()): string | null {
  if (state.startMode === "later") {
    const start = scheduleStartDate(state);
    if (!start) return "Pick the date and time to start sending.";
    if (start.getTime() < now.getTime() + 60_000) return "The start time has to be in the future.";
  }
  if (!(state.windowStart < state.windowEnd)) return "The send window has to end after it starts.";
  if (!isValidTimeZone(state.timezone)) return "That time zone isn't recognised.";
  for (let i = 0; i < state.followUps.length; i++) {
    const f = state.followUps[i];
    if (f.delayDays <= 0 && f.delayHours <= 0 && f.delayMinutes <= 0) return `Set how long to wait before follow-up ${i + 1}.`;
    if (!textOf(f.bodyHtml)) return `Write the message for follow-up ${i + 1}, or remove it.`;
    if (!state.threadEmails && !f.subject.trim()) return `Follow-up ${i + 1} needs a subject.`;
  }
  return null;
}

/** One line for the bar: "Starts now · 2 follow-ups · stops on reply". */
export function scheduleSummary(state: ScheduleFlowState): string {
  const parts: string[] = [];
  if (state.startMode === "later") {
    const start = scheduleStartDate(state);
    parts.push(
      start
        ? `Starts ${new Intl.DateTimeFormat("en-GB", {
            timeZone: state.timezone,
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(start)}`
        : "Pick a start time",
    );
  } else {
    parts.push("Starts now");
  }
  const n = state.followUps.length;
  parts.push(n === 0 ? "no follow-ups" : `${n} follow-up${n === 1 ? "" : "s"}`);
  parts.push(state.exitOnReply ? "stops on reply" : "keeps going after a reply");
  return parts.join(" · ");
}

export function followUpDelayLabel(f: FollowUpDraft, businessDaysOnly: boolean): string {
  return describeDelay(f.delayDays, f.delayHours, f.delayMinutes, businessDaysOnly);
}
