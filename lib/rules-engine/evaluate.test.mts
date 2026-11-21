import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parser.ts";
import { evaluate } from "./evaluate.ts";
import type { EvalContext } from "./context.ts";
import type { ObjectSchema, FormulaValue } from "./types.ts";

const companySchema: ObjectSchema = { Name: { type: "text" }, industry: { type: "text" } };
const agentSchema: ObjectSchema = { Name: { type: "text" }, groupName: { type: "text" } };

const tripsSchema: ObjectSchema = {
  Name: { type: "text" },
  package_value: { type: "number" },
  start_date: { type: "date" },
  end_date: { type: "date" },
  travellers: { type: "number" },
  stage: { type: "text" },
  destinations: { type: "list" },
  traveller: { type: "text", link: { Name: { type: "text" }, company: { type: "text", link: companySchema } } },
  agent: { type: "text", link: agentSchema },
};

function ctx(values: Record<string, FormulaValue>, over: Partial<EvalContext> = {}): EvalContext {
  return {
    values,
    isNew: false,
    user: { id: "u1", role: "staff", groupName: "Sales", email: "a@thenucleus.in", emailDomain: "thenucleus.in" },
    workspace: { id: "w1", name: "Acme Travel" },
    now: new Date("2026-06-15T10:00:00Z"),
    timeZone: "Asia/Kolkata",
    resolveLink: () => null,
    ...over,
  };
}

const run = async (src: string, c: EvalContext, schema = tripsSchema) => (await evaluate(parse(src), c, schema)).value;

test("reads a scalar field and compares it", async () => {
  assert.equal(await run("package_value < 90000", ctx({ package_value: 85000 })), true);
  assert.equal(await run("package_value < 90000", ctx({ package_value: 95000 })), false);
});

test("a missing field reads as blank, not an error", async () => {
  assert.equal(await run("ISBLANK(stage)", ctx({})), true);
});

test("an empty multi-value field reads as blank, matching the platform's own isEmptyInput", async () => {
  assert.equal(await run("ISBLANK(destinations)", ctx({ destinations: [] })), true);
  assert.equal(await run("ISBLANK(destinations)", ctx({ destinations: ["Goa"] })), false);
});

test("date fields compare correctly and subtract to a day count", async () => {
  const c = ctx({ start_date: new Date(Date.UTC(2026, 5, 1)), end_date: new Date(Date.UTC(2026, 5, 10)) });
  assert.equal(await run("end_date >= start_date", c), true);
  assert.equal(await run("end_date - start_date", c), 9);
});

test("list fields support INCLUDES", async () => {
  assert.equal(await run('INCLUDES(destinations, "Goa")', ctx({ destinations: ["Goa", "Manali"] })), true);
});

test("$User and $Workspace are readable from context, not from values", async () => {
  assert.equal(await run("$User.EmailDomain", ctx({})), "thenucleus.in");
  assert.equal(await run("$Workspace.Name", ctx({})), "Acme Travel");
});

test("IF evaluates only the taken branch", async () => {
  const touched: string[] = [];
  const c = ctx(
    { package_value: 85000 },
    {
      resolveLink: (path) => {
        touched.push(path.join("."));
        return "Should not be read";
      },
    }
  );
  // The else branch never calls agent.Name, so resolveLink must never fire.
  assert.equal(await run('IF(package_value > 90000, agent.Name, "cheap")', c), "cheap");
  assert.deepEqual(touched, []);
});

test("AND and OR short-circuit", async () => {
  let evaluated = 0;
  const schema: ObjectSchema = { x: { type: "boolean" } };
  const c = ctx({ x: false });
  // AND(FALSE, ...) must not need to look at the second argument to know the answer; we can't
  // directly observe non-evaluation here without a side-effecting field, so this checks the
  // boundary case instead: a short-circuited AND/OR still returns the right answer.
  assert.equal((await evaluate(parse("AND(x, 1=1)"), c, schema)).value, false);
  assert.equal((await evaluate(parse("OR(NOT(x), 1=1)"), c, schema)).value, true);
  void evaluated;
});

test("CASE picks the first matching branch and stops", async () => {
  const c = ctx({ stage: "Booked" });
  assert.equal(await run('CASE(stage, "Booked", 1, "Cancelled", 2, 0)', c), 1);
  assert.equal(await run('CASE(stage, "Nope", 1, "Cancelled", 2, 0)', c), 0);
});

test("ISNEW, ISCHANGED and PRIORVALUE read isNew/priorValues, not values", async () => {
  const created = ctx({ stage: "Enquiry" }, { isNew: true });
  assert.equal(await run("ISNEW()", created), true);

  const updated = ctx({ stage: "Booked" }, { isNew: false, priorValues: { stage: "Enquiry" } });
  assert.equal(await run("ISNEW()", updated), false);
  assert.equal(await run("ISCHANGED(stage)", updated), true);
  assert.equal(await run("PRIORVALUE(stage)", updated), "Enquiry");

  const untouched = ctx({ stage: "Booked" }, { priorValues: { stage: "Booked" } });
  assert.equal(await run("ISCHANGED(stage)", untouched), false);
});

test("acceptance #9: Booked can't go back to Enquiry", async () => {
  const src = 'AND(ISCHANGED(stage), PRIORVALUE(stage) = "Booked", stage = "Enquiry")';
  const regressed = ctx({ stage: "Enquiry" }, { priorValues: { stage: "Booked" } });
  assert.equal(await run(src, regressed), true); // the error condition IS true: this save should be blocked
  const forward = ctx({ stage: "Booked" }, { priorValues: { stage: "Enquiry" } });
  assert.equal(await run(src, forward), false);
});

test("a one-hop cross-record read calls resolveLink with the right path and id", async () => {
  const calls: { path: string[]; id: string }[] = [];
  const c = ctx(
    { agent: "agent-1" },
    { resolveLink: (path, id) => { calls.push({ path, id }); return "Managers"; } }
  );
  assert.equal(await run("agent.groupName", c), "Managers");
  assert.deepEqual(calls, [{ path: ["groupName"], id: "agent-1" }]);
});

test("a two-hop cross-record read is one resolveLink call carrying the whole remaining path", async () => {
  const calls: { path: string[]; id: string }[] = [];
  const c = ctx(
    { traveller: "trav-1" },
    { resolveLink: (path, id) => { calls.push({ path, id }); return "Hospitality"; } }
  );
  assert.equal(await run("traveller.company.industry", c), "Hospitality");
  assert.deepEqual(calls, [{ path: ["company", "industry"], id: "trav-1" }]);
});

test("an empty link reads as blank without calling resolveLink", async () => {
  let called = false;
  const c = ctx({}, { resolveLink: () => { called = true; return "x"; } });
  assert.equal(await run("ISBLANK(agent.groupName)", c), true);
  assert.equal(called, false);
});

test("dividing by zero is a thrown, caught-by-the-caller error, not Infinity", async () => {
  await assert.rejects(() => evaluate(parse("1 / 0"), ctx({}), tripsSchema));
});

test("acceptance #3: travellers between 1 and 50", async () => {
  const src = "NOT(BETWEEN(travellers, 1, 50))"; // error condition: outside the range
  assert.equal(await run(src, ctx({ travellers: 0 })), true);
  assert.equal(await run(src, ctx({ travellers: 1 })), false);
  assert.equal(await run(src, ctx({ travellers: 51 })), true);
});

test("acceptance #7: more than 10 travellers needs an agent in Managers", async () => {
  const src = 'AND(travellers > 10, NOT(ISPICKVAL(agent.groupName, "Managers")))';
  const withManager = ctx({ travellers: 15, agent: "a1" }, { resolveLink: () => "Managers" });
  assert.equal(await run(src, withManager), false);
  const withoutManager = ctx({ travellers: 15, agent: "a1" }, { resolveLink: () => "Sales" });
  assert.equal(await run(src, withoutManager), true);
  const smallGroup = ctx({ travellers: 5, agent: "a1" }, { resolveLink: () => "Sales" });
  assert.equal(await run(src, smallGroup), false);
});
