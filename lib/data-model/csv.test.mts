import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvRow, guessMapping, parseCsv } from "./csv.ts";

test("plain values pass through; empty is empty", () => {
  assert.equal(csvCell("Ana"), "Ana");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(false), "false");
});

test("commas, quotes and newlines are quoted and escaped", () => {
  assert.equal(csvCell("Smith, Ana"), '"Smith, Ana"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a\nb"), '"a\nb"');
});

test("text that would run as a spreadsheet formula is defused", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvCell("+91 98765"), "'+91 98765");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
});

test("real negative numbers are not mangled", () => {
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("-12.5"), "-12.5");
});

test("a row joins cells", () => {
  assert.equal(csvRow(["a", "b,c", null]), 'a,"b,c",');
});

test("parseCsv reads quoted cells, doubled quotes and newlines inside quotes", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n"line1\nline2",z'), [["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
});

test("parseCsv handles CRLF, a BOM, a missing final newline and blank lines", () => {
  assert.deepEqual(parseCsv("\uFEFFa,b\r\n1,2\r\n\r\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("parseCsv keeps empty cells and a quoted empty cell", () => {
  assert.deepEqual(parseCsv('a,,c\n"",,'), [["a", "", "c"], ["", "", ""]]);
});

test("parseCsv round-trips what csvRow writes", () => {
  const rows = [["Name", "Note"], ["Ana, B", 'a "quote"'], ["x", "multi\nline"]];
  assert.deepEqual(parseCsv(rows.map((r) => csvRow(r)).join("\r\n")), rows);
});

test("guessMapping matches headers to fields without reusing one", () => {
  const attrs = [{ slug: "email_addresses", name: "Email addresses" }, { slug: "job_title", name: "Job title" }, { slug: "phone_numbers", name: "Phone numbers" }];
  assert.deepEqual(guessMapping(["Full Name", "E-mail", "Job Title", "Mobile", "Whatever", "Name"], attrs), ["name", "email_addresses", "job_title", "phone_numbers", null, null]);
});
