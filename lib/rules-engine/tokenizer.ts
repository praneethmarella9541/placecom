import { FormulaError, type Position } from "./types";

/**
 * Lexer. Pure: text in, tokens out. Never executes anything — a formula is data from here on.
 */

export type TokenType =
  | "number"
  | "string"
  | "ident"
  | "("
  | ")"
  | ","
  | "."
  | "+"
  | "-"
  | "*"
  | "/"
  | "&"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "eof";

export type Token = { type: TokenType; text: string; value?: number | string; pos: Position };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Turns formula source into a flat token list ending in "eof". Throws FormulaError on bad input. */
export function tokenize(source: string): Token[] {
  if (source.length > 10_000) throw new FormulaError("This formula is too long.", { start: 0, end: source.length });
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  const push = (type: TokenType, text: string, start: number, value?: number | string) =>
    tokens.push({ type, text, value, pos: { start, end: start + text.length } });

  while (i < n) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      const start = i;
      while (i < n && source[i] >= "0" && source[i] <= "9") i++;
      if (source[i] === "." && source[i + 1] >= "0" && source[i + 1] <= "9") {
        i++;
        while (i < n && source[i] >= "0" && source[i] <= "9") i++;
      }
      const text = source.slice(start, i);
      push("number", text, start, Number(text));
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          const esc = source[i + 1];
          value += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          i += 2;
        } else {
          value += source[i];
          i++;
        }
      }
      if (i >= n) throw new FormulaError("This text is missing its closing quote.", { start, end: n });
      i++; // closing quote
      push("string", source.slice(start, i), start, value);
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      i++;
      while (i < n && IDENT_PART.test(source[i])) i++;
      push("ident", source.slice(start, i), start);
      continue;
    }

    const two = source.slice(i, i + 2);
    if (two === "!=" || two === "<=" || two === ">=" || two === "<>") {
      push(two === "<>" ? "!=" : (two as TokenType), two, i);
      i += 2;
      continue;
    }

    if ("()+-*/&=<>,.".includes(ch)) {
      push(ch as TokenType, ch, i);
      i++;
      continue;
    }

    throw new FormulaError(`"${ch}" isn't allowed here.`, { start: i, end: i + 1 });
  }

  tokens.push({ type: "eof", text: "", pos: { start: n, end: n } });
  return tokens;
}
