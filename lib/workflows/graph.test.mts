import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, defaultConfig, removeBlock, sanitizeBlockConfig, validateGraph, blockOrder } from "./graph.ts";
import type { Graph } from "./types";

const empty: Graph = { start: null, blocks: {} };

test("an empty draft is valid; publishing needs a block", () => {
  assert.equal(validateGraph(empty).ok, true);
  assert.equal(validateGraph(empty, true).ok, false);
});

test("addBlock inserts in the middle and keeps the rest of the path", () => {
  let g = addBlock(empty, { parent: null, slot: "next" }, "filter").graph;
  g = addBlock(g, { parent: "b1", slot: "next" }, "create_task").graph;
  g = addBlock(g, { parent: "b1", slot: "next" }, "delay").graph; // between filter and task
  assert.deepEqual(blockOrder(g).map((b) => b.type), ["filter", "delay", "create_task"]);
});

test("an if/else keeps the old path on yes and has two empty-able branches", () => {
  let g = addBlock(empty, { parent: null, slot: "next" }, "create_task").graph;
  const r = addBlock(g, { parent: null, slot: "next" }, "if_else");
  g = r.graph;
  assert.equal(g.start, r.key);
  assert.equal(g.blocks[r.key].yes, "b1");
  g = addBlock(g, { parent: r.key, slot: "no" }, "delay").graph;
  assert.deepEqual(blockOrder(g).map((b) => b.type), ["if_else", "create_task", "delay"]);
});

test("removing a block closes the path; removing an if/else drops its no path", () => {
  let g = addBlock(empty, { parent: null, slot: "next" }, "filter").graph;
  g = addBlock(g, { parent: "b1", slot: "next" }, "delay").graph;
  g = addBlock(g, { parent: "b2", slot: "next" }, "create_task").graph;
  assert.deepEqual(blockOrder(removeBlock(g, "b2")).map((b) => b.type), ["filter", "create_task"]);

  let h = addBlock(empty, { parent: null, slot: "next" }, "if_else").graph; // b1
  h = addBlock(h, { parent: "b1", slot: "yes" }, "create_task").graph; // b2
  h = addBlock(h, { parent: "b1", slot: "no" }, "delay").graph; // b3
  const after = removeBlock(h, "b1");
  assert.deepEqual(blockOrder(after).map((b) => b.type), ["create_task"]);
  assert.equal(after.blocks.b3, undefined);
});

test("removing the first block moves the start", () => {
  let g = addBlock(empty, { parent: null, slot: "next" }, "filter").graph;
  g = addBlock(g, { parent: "b1", slot: "next" }, "delay").graph;
  assert.equal(removeBlock(g, "b1").start, "b2");
});

test("a block reached from two places, a missing target, or a loose block is refused", () => {
  const two: Graph = { start: "b1", blocks: { b1: { key: "b1", type: "if_else", config: defaultConfig("if_else"), yes: "b2", no: "b2" }, b2: { key: "b2", type: "delay", config: defaultConfig("delay"), next: null } } };
  assert.equal(validateGraph(two).ok, false);
  const missing: Graph = { start: "b1", blocks: { b1: { key: "b1", type: "delay", config: defaultConfig("delay"), next: "b9" } } };
  assert.equal(validateGraph(missing).ok, false);
  const loose: Graph = { start: "b1", blocks: { b1: { key: "b1", type: "delay", config: defaultConfig("delay"), next: null }, b2: { key: "b2", type: "delay", config: defaultConfig("delay"), next: null } } };
  assert.equal(validateGraph(loose).ok, false);
});

test("a loop is refused", () => {
  const loop: Graph = { start: "b1", blocks: { b1: { key: "b1", type: "delay", config: defaultConfig("delay"), next: "b2" }, b2: { key: "b2", type: "delay", config: defaultConfig("delay"), next: "b1" } } };
  assert.equal(validateGraph(loop).ok, false);
});

test("a draft may hold an unfinished block; a publish may not", () => {
  const g = addBlock(empty, { parent: null, slot: "next" }, "create_task").graph; // title still empty
  assert.equal(validateGraph(g).ok, true);
  const p = validateGraph(g, true);
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.errors.join(" "), /title/i);
});

test("block settings are cleaned", () => {
  assert.equal(sanitizeBlockConfig("delay", { amount: 0, unit: "days" }).ok, false);
  assert.equal(sanitizeBlockConfig("delay", { amount: 400, unit: "days" }).ok, false);
  assert.equal(sanitizeBlockConfig("delay", { amount: 90, unit: "minutes" }).ok, true);
  assert.equal(sanitizeBlockConfig("add_to_list", { list: "nope" }).ok, false);
  assert.equal(sanitizeBlockConfig("create_note", { body: "  " }).ok, false);
  const t = sanitizeBlockConfig("create_task", { title: "Call", dueInDays: 2, assignee: "owner" });
  assert.equal(t.ok, true);
  assert.equal(sanitizeBlockConfig("create_task", { title: "Call", dueInDays: -1 }).ok, false);
  assert.equal(sanitizeBlockConfig("filter", { conditions: [{ left: "x", op: "shell" }] }).ok, false);
});

test("too many blocks are refused", () => {
  const blocks: Graph["blocks"] = {};
  for (let i = 1; i <= 41; i++) blocks[`b${i}`] = { key: `b${i}`, type: "delay", config: defaultConfig("delay"), next: i < 41 ? `b${i + 1}` : null };
  assert.equal(validateGraph({ start: "b1", blocks }).ok, false);
});
