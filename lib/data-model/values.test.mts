// Run with: npm test   (node's built-in runner; no extra dependency)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDependentOptions, extractKeys, normalizeValue, validateRecordInput } from "./values.ts";
import type { AttributeDef } from "./types";

const attr = (over: Partial<AttributeDef> & Pick<AttributeDef, "type">): AttributeDef => ({
  slug: "x",
  name: "X",
  is_multi: false,
  config: {},
  is_required: false,
  is_unique: false,
  ...over,
});

const ok = (a: AttributeDef, raw: unknown) => {
  const r = normalizeValue(a, raw);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.value : undefined;
};
const bad = (a: AttributeDef, raw: unknown) => assert.equal(normalizeValue(a, raw).ok, false);

test("empty input clears", () => {
  for (const raw of [null, undefined, "", "   ", []]) assert.equal(ok(attr({ type: "text" }), raw), null);
});

test("text is trimmed and length-limited", () => {
  assert.equal(ok(attr({ type: "text" }), "  hi  "), "hi");
  bad(attr({ type: "text" }), "a".repeat(501));
  bad(attr({ type: "text" }), 5);
});

test("numbers accept numeric strings with commas, refuse the rest", () => {
  assert.equal(ok(attr({ type: "number" }), "1,250.5"), 1250.5);
  assert.equal(ok(attr({ type: "currency" }), 0), 0);
  bad(attr({ type: "number" }), "abc");
  bad(attr({ type: "number" }), Infinity);
});

test("number/currency min and max constraints", () => {
  const packageValue = attr({ type: "currency", config: { min: 90000 } });
  assert.equal(ok(packageValue, 90000), 90000); // inclusive
  bad(packageValue, 89999);
  const travellers = attr({ type: "number", config: { min: 1, max: 50 } });
  assert.equal(ok(travellers, 25), 25);
  bad(travellers, 0);
  bad(travellers, 51);
});

test("text min/max length and a pattern with a custom message", () => {
  const t = attr({ type: "text", config: { minLength: 3, maxLength: 10 } });
  assert.equal(ok(t, "hello"), "hello");
  bad(t, "hi");
  bad(t, "a".repeat(11));
  const patterned = attr({ type: "text", config: { pattern: "[A-Z]{2}\\d{4}", patternMessage: "Use two capital letters then 4 digits." } });
  assert.equal(ok(patterned, "AB1234"), "AB1234");
  const r = normalizeValue(patterned, "ab1234");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /two capital letters/);
});

test("date min/max constraints, inclusive on both ends", () => {
  const d = attr({ type: "date", config: { min: "2026-01-01", max: "2026-12-31" } });
  assert.equal(ok(d, "2026-01-01"), "2026-01-01");
  assert.equal(ok(d, "2026-12-31"), "2026-12-31");
  bad(d, "2025-12-31");
  bad(d, "2027-01-01");
});

test("an invalid admin-authored pattern doesn't block every save", () => {
  const broken = attr({ type: "text", config: { pattern: "(" } });
  assert.equal(ok(broken, "anything"), "anything");
});

test("checkbox takes booleans and the strings true/false", () => {
  assert.equal(ok(attr({ type: "checkbox" }), false), false);
  assert.equal(ok(attr({ type: "checkbox" }), "true"), true);
  bad(attr({ type: "checkbox" }), "yes");
});

test("dates accept common formats and normalize to YYYY-MM-DD", () => {
  const d = attr({ type: "date" });
  assert.equal(ok(d, "2026-12-31"), "2026-12-31");
  assert.equal(ok(d, "31/12/2026"), "2026-12-31");
  assert.equal(ok(d, "12/31/2026"), "2026-12-31"); // 31 can't be a month, so this must be month/day/year
  assert.equal(ok(d, "31-12-26"), "2026-12-31");
  assert.equal(ok(d, "2026/01/05"), "2026-01-05");
  assert.equal(ok(d, "31 Dec 2026"), "2026-12-31");
  assert.equal(ok(d, "Dec 31, 2026"), "2026-12-31");
  assert.equal(ok(d, "December 31 2026"), "2026-12-31");
  assert.equal(ok(d, "31st December 2026"), "2026-12-31");
  assert.equal(ok(d, "5/6/2026"), "2026-06-05"); // ambiguous day/month: read as day/month/year
  bad(d, "2026-02-30");
  bad(d, "not a date");
});

test("timestamps are stored as ISO strings", () => {
  assert.equal(ok(attr({ type: "timestamp" }), "2026-01-02T03:04:05Z"), "2026-01-02T03:04:05.000Z");
  bad(attr({ type: "timestamp" }), "nope");
});

test("rating stays inside its scale", () => {
  assert.equal(ok(attr({ type: "rating" }), 5), 5);
  bad(attr({ type: "rating" }), 6);
  bad(attr({ type: "rating" }), 2.5);
  bad(attr({ type: "rating", config: { max: 3 } }), 4);
});

test("select matches options case-insensitively and returns the canonical spelling", () => {
  const a = attr({ type: "select", config: { options: ["Hot", "Cold"] } });
  assert.equal(ok(a, "hot"), "Hot");
  bad(a, "Warm");
  const m = attr({ type: "multi_select", config: { options: ["A", "B"] } });
  assert.deepEqual(ok(m, ["a", "B", "b"]), ["A", "B"]);
});

test("email is lower-cased; junk is refused", () => {
  assert.equal(ok(attr({ type: "email" }), " Ana@Example.COM "), "ana@example.com");
  bad(attr({ type: "email" }), "ana@");
  bad(attr({ type: "email" }), "ana example@x.com");
  bad(attr({ type: "email" }), "a@b");
});

test("phone drops spacing and needs 6-15 digits", () => {
  assert.equal(ok(attr({ type: "phone" }), "+91 98765-43210"), "+919876543210");
  bad(attr({ type: "phone" }), "12");
  bad(attr({ type: "phone" }), "call me");
});

test("url only allows http and https", () => {
  assert.equal(ok(attr({ type: "url" }), "example.com/a"), "https://example.com/a");
  bad(attr({ type: "url" }), "javascript:alert(1)");
  bad(attr({ type: "url" }), "data:text/html,hi");
  bad(attr({ type: "url" }), "ftp://example.com");
});

test("domain strips scheme, www and path", () => {
  assert.equal(ok(attr({ type: "domain" }), "https://www.Example.com/about"), "example.com");
  bad(attr({ type: "domain" }), "not a domain");
  bad(attr({ type: "domain" }), "localhost");
});

test("references need a uuid", () => {
  const id = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
  assert.equal(ok(attr({ type: "record_ref" }), id), id.toLowerCase());
  bad(attr({ type: "record_ref" }), "123");
});

test("a multi attribute takes a list, dedupes and clears when empty", () => {
  const a = attr({ type: "email", is_multi: true });
  assert.deepEqual(ok(a, ["A@x.com", "a@x.com", "b@x.com"]), ["a@x.com", "b@x.com"]);
  assert.deepEqual(ok(a, "c@x.com"), ["c@x.com"]);
  assert.equal(ok(a, ["", " "]), null);
  bad(a, ["a@x.com", "nope"]);
});

test("a single attribute refuses a list", () => {
  bad(attr({ type: "text" }), ["a", "b"]);
});

const people: AttributeDef[] = [
  attr({ slug: "email_addresses", name: "Email addresses", type: "email", is_multi: true, is_unique: true }),
  attr({ slug: "job_title", name: "Job title", type: "text" }),
  attr({ slug: "rank", name: "Rank", type: "rating", is_required: true }),
];

test("create needs a name and every required attribute", () => {
  const r = validateRecordInput(people, { values: { job_title: "CEO" } }, "create");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual([...r.errors].sort(), ["Name is required.", "Rank: is required."]);
});

test("create collects every error, not just the first", () => {
  const r = validateRecordInput(people, { name: "A", values: { email_addresses: ["bad"], nope: 1, rank: 9 } }, "create");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 3);
});

test("update only checks what was sent, clears with null, refuses clearing a required field", () => {
  const good = validateRecordInput(people, { values: { job_title: null, email_addresses: ["A@x.com"] } }, "update");
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.deepEqual(good.values, { email_addresses: ["a@x.com"] });
    assert.deepEqual(good.cleared, ["job_title"]);
  }
  assert.equal(validateRecordInput(people, { values: { rank: null } }, "update").ok, false);
  assert.equal(validateRecordInput(people, { name: "  " }, "update").ok, false);
});

test("archived attributes are not accepted", () => {
  const archived = [{ ...people[1], archived_at: "2026-01-01T00:00:00Z" }];
  assert.equal(validateRecordInput(archived, { values: { job_title: "x" } }, "update").ok, false);
});

test("keys come from unique email and domain attributes only", () => {
  const keys = extractKeys(people, { email_addresses: ["a@x.com", "A@X.com", "b@x.com"], job_title: "x" });
  assert.deepEqual(keys, [
    { kind: "email", value: "a@x.com" },
    { kind: "email", value: "b@x.com" },
  ]);
  assert.deepEqual(extractKeys(people, {}), []);
});

const dependentAttrs: AttributeDef[] = [
  {
    slug: "destination_type",
    name: "Destination type",
    type: "select",
    is_multi: false,
    config: { options: ["International", "Domestic"] },
    is_required: false,
    is_unique: false,
  },
  {
    slug: "package",
    name: "Package",
    type: "select",
    is_multi: false,
    config: {
      options: ["Beach Resort", "City Tour", "Safari", "Local Homestay"],
      controlledBy: "destination_type",
      dependentOptions: {
        International: ["Beach Resort", "Safari"],
        Domestic: ["City Tour", "Local Homestay"],
      },
    },
    is_required: false,
    is_unique: false,
  },
];

test("checkDependentOptions allows only the mapped subset for the controlling value", () => {
  assert.deepEqual(checkDependentOptions(dependentAttrs, { destination_type: "International", package: "Beach Resort" }), []);
  assert.deepEqual(checkDependentOptions(dependentAttrs, { destination_type: "Domestic", package: "Beach Resort" }), [
    'Package: "Beach Resort" isn\'t allowed when Destination type is "Domestic".',
  ]);
});

test("checkDependentOptions does nothing until the controlling field has a value", () => {
  assert.deepEqual(checkDependentOptions(dependentAttrs, { package: "Beach Resort" }), []);
});

test("checkDependentOptions refuses a controlling value with no mapped entry at all", () => {
  const withGap = [dependentAttrs[0], { ...dependentAttrs[1], config: { ...dependentAttrs[1].config, dependentOptions: { International: ["Beach Resort"] } } }];
  assert.deepEqual(checkDependentOptions(withGap, { destination_type: "Domestic", package: "City Tour" }), [
    'Package: "City Tour" isn\'t allowed when Destination type is "Domestic".',
  ]);
});
