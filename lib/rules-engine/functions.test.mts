import { test } from "node:test";
import assert from "node:assert/strict";
import { FUNCTIONS, callFunction, todayInZone } from "./functions.ts";
import type { Typed } from "./types.ts";
import type { EvalContext } from "./context.ts";

const POS = { start: 0, end: 0 };

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    values: {},
    isNew: false,
    user: { id: "u1", role: "staff", groupName: null, email: "a@x.com", emailDomain: "x.com" },
    workspace: { id: "w1", name: "Acme" },
    now: new Date("2026-06-15T10:00:00Z"),
    timeZone: "Asia/Kolkata",
    resolveLink: () => null,
    ...over,
  };
}

const T = {
  n: (value: number): Typed => ({ value, type: "number" }),
  t: (value: string): Typed => ({ value, type: "text" }),
  b: (value: boolean): Typed => ({ value, type: "boolean" }),
  d: (value: Date): Typed => ({ value, type: "date" }),
  dt: (value: Date): Typed => ({ value, type: "datetime" }),
  list: (value: string[]): Typed => ({ value, type: "list" }),
  null: (): Typed => ({ value: null, type: "null" }),
};

const call = (name: string, args: Typed[], c = ctx()) => callFunction(name, args, c, POS).value;

test("ABS, ROUND, MIN, MAX, MOD", () => {
  assert.equal(call("ABS", [T.n(-5)]), 5);
  assert.equal(call("ABS", [T.n(0)]), 0);
  assert.equal(call("ROUND", [T.n(1.005)]), 1); // float noise: 1.005 is really 1.00499...
  assert.equal(call("ROUND", [T.n(2.5), T.n(0)]), 3);
  assert.equal(call("MIN", [T.n(3), T.n(-1), T.n(7)]), -1);
  assert.equal(call("MAX", [T.n(3), T.n(-1), T.n(7)]), 7);
  assert.equal(call("MOD", [T.n(7), T.n(3)]), 1);
  assert.equal(call("MOD", [T.n(-7), T.n(3)]), -1); // JS % keeps the dividend's sign
});

test("LEN, LEFT, RIGHT, MID, TRIM, UPPER, LOWER — including empty and Unicode text", () => {
  assert.equal(call("LEN", [T.t("")]), 0);
  assert.equal(call("LEN", [T.t("héllo")]), 5);
  assert.equal(call("LEFT", [T.t("hello"), T.n(2)]), "he");
  assert.equal(call("LEFT", [T.t("hi"), T.n(99)]), "hi");
  assert.equal(call("RIGHT", [T.t("hello"), T.n(2)]), "lo");
  assert.equal(call("RIGHT", [T.t("hi"), T.n(0)]), "");
  assert.equal(call("MID", [T.t("hello"), T.n(2), T.n(3)]), "ell"); // 1-indexed
  assert.equal(call("TRIM", [T.t("  hi  ")]), "hi");
  assert.equal(call("UPPER", [T.t("café")]), "CAFÉ");
  assert.equal(call("LOWER", [T.t("CAFÉ")]), "café");
});

test("CONTAINS, BEGINS, ENDS are case-sensitive substring checks", () => {
  assert.equal(call("CONTAINS", [T.t("Hello World"), T.t("World")]), true);
  assert.equal(call("CONTAINS", [T.t("Hello World"), T.t("world")]), false);
  assert.equal(call("BEGINS", [T.t("Hello"), T.t("He")]), true);
  assert.equal(call("ENDS", [T.t("Hello"), T.t("lo")]), true);
  assert.equal(call("CONTAINS", [T.t(""), T.t("x")]), false);
});

test("REGEX matches the whole string, and a bad or slow pattern reads as no match rather than throwing", () => {
  assert.equal(call("REGEX", [T.t("abc123"), T.t("[a-z]+[0-9]+")]), true);
  assert.equal(call("REGEX", [T.t("abc123x"), T.t("[a-z]+[0-9]+")]), false); // not a full match
  assert.equal(call("REGEX", [T.t("anything"), T.t("(")]), false); // invalid pattern
  assert.equal(call("REGEX", [T.t("a".repeat(40) + "!"), T.t("(a+)+$")]), false); // classic ReDoS shape: times out, not hangs
});

test("TEXT and VALUE round-trip, and TEXT(blank) is empty text", () => {
  assert.equal(call("TEXT", [T.n(42)]), "42");
  assert.equal(call("TEXT", [T.b(true)]), "true");
  assert.equal(call("TEXT", [T.null()]), "");
  assert.equal(call("TEXT", [T.d(new Date(Date.UTC(2026, 11, 31)))]), "2026-12-31");
  assert.equal(call("VALUE", [T.t("1,250.5")]), 1250.5);
  assert.throws(() => call("VALUE", [T.t("not a number")]));
});

test("TODAY reads the calendar date in the tenant time zone, not UTC", () => {
  // 2026-06-15T19:00:00Z is already 2026-06-16 at 00:30 in Asia/Kolkata (+05:30).
  const late = ctx({ now: new Date("2026-06-15T19:00:00Z") });
  const today = call("TODAY", [], late) as Date;
  assert.equal(today.toISOString().slice(0, 10), "2026-06-16");
});

test("DATE validates real calendar days, including leap days", () => {
  assert.equal((call("DATE", [T.n(2024), T.n(2), T.n(29)]) as Date).getUTCDate(), 29); // 2024 is a leap year
  assert.throws(() => call("DATE", [T.n(2023), T.n(2), T.n(29)])); // 2023 is not
  assert.throws(() => call("DATE", [T.n(2026), T.n(13), T.n(1)]));
});

test("ADDDAYS and ADDMONTHS, including month-end clamping behaviour", () => {
  const d = new Date(Date.UTC(2026, 0, 31)); // Jan 31
  const plusDays = call("ADDDAYS", [T.d(d), T.n(1)]) as Date;
  assert.equal(plusDays.toISOString().slice(0, 10), "2026-02-01");
  const plusMonth = call("ADDMONTHS", [T.d(d), T.n(1)]) as Date; // Feb has no 31st
  assert.equal(plusMonth.getUTCMonth(), 2); // JS Date rolls this into March 3rd
});

test("DAYS_BETWEEN, including negative and zero", () => {
  const a = new Date(Date.UTC(2026, 0, 1));
  const b = new Date(Date.UTC(2026, 0, 5));
  assert.equal(call("DAYS_BETWEEN", [T.d(a), T.d(b)]), 4);
  assert.equal(call("DAYS_BETWEEN", [T.d(b), T.d(a)]), -4);
  assert.equal(call("DAYS_BETWEEN", [T.d(a), T.d(a)]), 0);
});

test("YEAR/MONTH/DAY/WEEKDAY on a date read in UTC; on a datetime, in the tenant zone", () => {
  const d = new Date(Date.UTC(2026, 0, 1)); // a Thursday
  assert.equal(call("YEAR", [T.d(d)]), 2026);
  assert.equal(call("MONTH", [T.d(d)]), 1);
  assert.equal(call("DAY", [T.d(d)]), 1);
  assert.equal(call("WEEKDAY", [T.d(d)]), 5); // 1=Sun..7=Sat

  const dt = new Date("2026-01-01T19:00:00Z"); // next calendar day in IST
  assert.equal(call("DAY", [T.dt(dt)]), 2);
});

test("ISBLANK, BLANKVALUE, NULLVALUE", () => {
  assert.equal(call("ISBLANK", [T.null()]), true);
  assert.equal(call("ISBLANK", [T.t("")]), true);
  assert.equal(call("ISBLANK", [T.t("  ")]), true);
  assert.equal(call("ISBLANK", [T.t("x")]), false);
  assert.equal(call("ISBLANK", [T.n(0)]), false); // zero is not blank
  assert.equal(call("ISBLANK", [T.b(false)]), false); // FALSE is not blank
  assert.equal(call("ISBLANK", [T.list([])]), true); // an empty multi-value field reads as blank...
  assert.equal(call("ISBLANK", [T.list(["A"])]), false); // ...matching lib/data-model/values.ts's isEmptyInput
  assert.equal(call("BLANKVALUE", [T.null(), T.t("default")]), "default");
  assert.equal(call("BLANKVALUE", [T.t("x"), T.t("default")]), "x");
});

test("BETWEEN is inclusive on both ends", () => {
  assert.equal(call("BETWEEN", [T.n(1), T.n(1), T.n(50)]), true);
  assert.equal(call("BETWEEN", [T.n(50), T.n(1), T.n(50)]), true);
  assert.equal(call("BETWEEN", [T.n(51), T.n(1), T.n(50)]), false);
  assert.equal(call("BETWEEN", [T.n(0), T.n(1), T.n(50)]), false);
});

test("ISPICKVAL and INCLUDES are case-insensitive", () => {
  assert.equal(call("ISPICKVAL", [T.t("Booked"), T.t("booked")]), true);
  assert.equal(call("ISPICKVAL", [T.null(), T.t("booked")]), false);
  assert.equal(call("INCLUDES", [T.list(["Goa", "Manali"]), T.t("goa")]), true);
  assert.equal(call("INCLUDES", [T.list([]), T.t("goa")]), false);
});

test("every function in the registry enforces its own arity", () => {
  assert.throws(() => call("ABS", []));
  assert.throws(() => call("ABS", [T.n(1), T.n(2)]));
  assert.throws(() => call("MIN", []));
  assert.throws(() => call("NOSUCHFUNCTION", [T.n(1)]));
});

test("todayInZone is exported for the engine's own TODAY() implementation", () => {
  assert.ok(todayInZone(new Date(), "Asia/Kolkata") instanceof Date);
});

test("the registry has every function the spec lists", () => {
  for (const name of [
    "ABS", "ROUND", "MIN", "MAX", "MOD",
    "LEN", "LEFT", "RIGHT", "MID", "TRIM", "UPPER", "LOWER", "CONTAINS", "BEGINS", "ENDS", "REGEX", "TEXT", "VALUE",
    "TODAY", "NOW", "DATE", "ADDDAYS", "ADDMONTHS", "DAYS_BETWEEN", "YEAR", "MONTH", "DAY", "WEEKDAY",
    "ISBLANK", "BLANKVALUE", "NULLVALUE", "BETWEEN", "ISPICKVAL", "INCLUDES",
  ]) {
    assert.ok(FUNCTIONS[name], `missing ${name}`);
  }
});
