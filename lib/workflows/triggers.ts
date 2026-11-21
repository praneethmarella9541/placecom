import type { Trigger, TriggerType, WorkflowEvent } from "./types";
import { TRIGGER_TYPES } from "./types";

const SLUG = /^[a-z][a-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Does this event start a workflow with this trigger? Pure; tested in triggers.test.mts. */
export function triggerMatches(trigger: Trigger, ev: Pick<WorkflowEvent, "type" | "object_slug" | "list_id" | "attribute_slug" | "old_value" | "new_value" | "payload">): boolean {
  const c = trigger.config;
  const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

  switch (trigger.type) {
    case "record_created":
      return ev.type === "record.created" && ev.object_slug === str(c.object);
    case "record_updated": {
      if (ev.type !== "record.updated" || ev.object_slug !== str(c.object)) return false;
      const wanted = Array.isArray(c.attributes) ? (c.attributes as unknown[]).filter((a): a is string => typeof a === "string") : [];
      if (!wanted.length) return true;
      const changed = Array.isArray(ev.payload?.changed) ? (ev.payload.changed as string[]) : [];
      return changed.some((s) => wanted.includes(s));
    }
    case "attribute_changed": {
      if (ev.type !== "attribute.changed" || ev.object_slug !== str(c.object) || ev.attribute_slug !== str(c.attribute)) return false;
      const from = str(c.from);
      const to = str(c.to);
      return (from === undefined || same(ev.old_value, from)) && (to === undefined || same(ev.new_value, to));
    }
    case "list_added":
      return ev.type === "list.added" && ev.list_id === str(c.list);
    case "list_entry_updated": {
      if (ev.type !== "list.entry_updated" || ev.list_id !== str(c.list)) return false;
      const attr = str(c.attribute);
      if (attr && ev.attribute_slug !== attr) return false;
      const to = str(c.to);
      return to === undefined || same(ev.new_value, to);
    }
    case "manual":
      return ev.type === "manual" && ev.object_slug === str(c.object);
    case "schedule":
      return false; // started by the scheduler, never by an event
    default:
      return false;
  }
}

/**
 * A trigger as saved in a DRAFT: possibly unfinished (an object picked but no field yet), so it is
 * only checked for safety, not completeness. Publishing re-checks it with sanitizeTrigger, which
 * insists on a complete one. Only plain values are kept, and the size is capped.
 */
export function sanitizeTriggerDraft(raw: unknown): { ok: true; trigger: Trigger } | { ok: false; error: string } {
  const strict = sanitizeTrigger(raw);
  if (strict.ok) return strict;
  const input = (raw ?? {}) as { type?: unknown; config?: unknown };
  if (typeof input.type !== "string" || !(TRIGGER_TYPES as readonly string[]).includes(input.type)) return strict;
  const config: Record<string, unknown> = {};
  if (input.config && typeof input.config === "object" && !Array.isArray(input.config)) {
    for (const [k, v] of Object.entries(input.config as Record<string, unknown>).slice(0, 20)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
      if (typeof v === "string") config[k] = v.slice(0, 200);
      else if (typeof v === "number" || typeof v === "boolean") config[k] = v;
      else if (Array.isArray(v)) config[k] = v.filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 60));
    }
  }
  return { ok: true, trigger: { type: input.type as TriggerType, config } };
}

/** Check a trigger from the API. Returns the cleaned trigger or why it isn't valid. */
export function sanitizeTrigger(raw: unknown): { ok: true; trigger: Trigger } | { ok: false; error: string } {
  const input = (raw ?? {}) as { type?: unknown; config?: unknown };
  if (input.type === null || input.type === undefined) return { ok: true, trigger: { type: null, config: {} } };
  if (typeof input.type !== "string" || !(TRIGGER_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: "Unknown trigger." };
  const type = input.type as TriggerType;
  const c = (input.config && typeof input.config === "object" && !Array.isArray(input.config) ? input.config : {}) as Record<string, unknown>;
  const slug = (v: unknown, what: string) => (typeof v === "string" && SLUG.test(v) ? v : null) ?? (() => { throw new Error(`Choose ${what}.`); })();
  const id = (v: unknown, what: string) => (typeof v === "string" && UUID.test(v) ? v : null) ?? (() => { throw new Error(`Choose ${what}.`); })();

  try {
    switch (type) {
      case "record_created":
      case "manual":
        return { ok: true, trigger: { type, config: { object: slug(c.object, "an object") } } };
      case "record_updated": {
        const attrs = Array.isArray(c.attributes) ? (c.attributes as unknown[]).filter((a): a is string => typeof a === "string" && SLUG.test(a)).slice(0, 20) : [];
        return { ok: true, trigger: { type, config: { object: slug(c.object, "an object"), attributes: attrs } } };
      }
      case "attribute_changed":
        return { ok: true, trigger: { type, config: { object: slug(c.object, "an object"), attribute: slug(c.attribute, "a field"), ...(str(c.from) ? { from: str(c.from)!.slice(0, 200) } : {}), ...(str(c.to) ? { to: str(c.to)!.slice(0, 200) } : {}) } } };
      case "list_added":
        return { ok: true, trigger: { type, config: { list: id(c.list, "a list") } } };
      case "list_entry_updated":
        return { ok: true, trigger: { type, config: { list: id(c.list, "a list"), ...(str(c.attribute) && (str(c.attribute) === "stage" || SLUG.test(str(c.attribute)!)) ? { attribute: str(c.attribute) } : {}), ...(str(c.to) ? { to: str(c.to)!.slice(0, 200) } : {}) } } };
      case "schedule": {
        const every = c.every === "hour" || c.every === "day" || c.every === "week" ? c.every : null;
        if (!every) return { ok: false, error: "Choose how often it runs." };
        const at = typeof c.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.at) ? c.at : "09:00";
        const weekday = Number.isInteger(c.weekday) && (c.weekday as number) >= 0 && (c.weekday as number) <= 6 ? (c.weekday as number) : 1;
        const tz = typeof c.tz === "string" && c.tz.length < 60 ? c.tz : "Asia/Kolkata";
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
        } catch {
          return { ok: false, error: "Unknown time zone." };
        }
        return { ok: true, trigger: { type, config: { every, at, weekday, tz } } };
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: false, error: "Unknown trigger." };
}
