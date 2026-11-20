import { resolveValue } from "./template";
import type { Condition, ConditionOp } from "./types";

const OPS = new Set<ConditionOp>(["eq", "neq", "contains", "not_contains", "gt", "lt", "empty", "not_empty"]);

export function isOp(v: unknown): v is ConditionOp {
  return typeof v === "string" && OPS.has(v as ConditionOp);
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const lower = (v: unknown) => String(v).trim().toLowerCase();
const items = (v: unknown) => (Array.isArray(v) ? v : [v]);

/** One condition against the run's data. Both sides can be variables. */
export function conditionHolds(c: Condition, data: unknown): boolean {
  const left = resolveValue(c.left, data);
  const right = resolveValue(c.right ?? "", data);
  switch (c.op) {
    case "empty":
      return isEmpty(left);
    case "not_empty":
      return !isEmpty(left);
    case "eq":
      return !isEmpty(left) ? items(left).some((l) => lower(l) === lower(right)) : isEmpty(right);
    case "neq":
      return !(!isEmpty(left) ? items(left).some((l) => lower(l) === lower(right)) : isEmpty(right));
    case "contains":
      return !isEmpty(left) && items(left).some((l) => lower(l).includes(lower(right)));
    case "not_contains":
      return isEmpty(left) || !items(left).some((l) => lower(l).includes(lower(right)));
    case "gt":
    case "lt": {
      const a = Number(typeof left === "string" ? left.replace(/,/g, "") : left);
      const b = Number(typeof right === "string" ? right.replace(/,/g, "") : right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === "gt" ? a > b : a < b;
    }
  }
}

/** A list of conditions joined by "all" (and) or "any" (or). No conditions at all counts as true. */
export function conditionsHold(match: "all" | "any", conditions: Condition[], data: unknown): boolean {
  if (!conditions.length) return true;
  return match === "any" ? conditions.some((c) => conditionHolds(c, data)) : conditions.every((c) => conditionHolds(c, data));
}
