import { tokenize, type Token, type TokenType } from "./tokenizer";
import type { Expr, BinaryOp } from "./ast";
import { FormulaError, type Position } from "./types";

/**
 * Recursive-descent parser. Tokens in, an Expr tree out — nothing is executed here, and nothing
 * the parser builds can execute later (see ast.ts). Logic (AND/OR/NOT), IF and CASE are ordinary
 * function calls, matching Salesforce; there is no "&&"/"||"/"?:" syntax.
 *
 * Precedence, low to high: comparison (non-chaining) < concatenation (&) < + - < * / < unary -.
 */

const COMPARISON_OPS = new Set<TokenType>(["=", "!=", "<", "<=", ">", ">="]);

class Parser {
  private tokens: Token[];
  private i = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private expect(type: TokenType, what: string): Token {
    const t = this.peek();
    if (t.type !== type) throw new FormulaError(`Expected ${what}.`, t.pos);
    return this.next();
  }

  private span(start: Position, end: Position): Position {
    return { start: start.start, end: end.end };
  }

  parseProgram(): Expr {
    const expr = this.parseComparison();
    const t = this.peek();
    if (t.type !== "eof") throw new FormulaError(`Unexpected "${t.text}".`, t.pos);
    return expr;
  }

  private parseComparison(): Expr {
    const left = this.parseConcat();
    const t = this.peek();
    if (COMPARISON_OPS.has(t.type)) {
      this.next();
      const right = this.parseConcat();
      return { kind: "binary", op: t.type as BinaryOp, left, right, pos: this.span(left.pos, right.pos) };
    }
    return left;
  }

  private parseConcat(): Expr {
    let left = this.parseAdditive();
    while (this.peek().type === "&") {
      this.next();
      const right = this.parseAdditive();
      left = { kind: "binary", op: "&", left, right, pos: this.span(left.pos, right.pos) };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().type === "+" || this.peek().type === "-") {
      const op = this.next().type as BinaryOp;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right, pos: this.span(left.pos, right.pos) };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.peek().type === "*" || this.peek().type === "/") {
      const op = this.next().type as BinaryOp;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right, pos: this.span(left.pos, right.pos) };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.peek().type === "-") {
      const minus = this.next();
      const expr = this.parseUnary();
      return { kind: "unary", op: "-", expr, pos: this.span(minus.pos, expr.pos) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.type === "(") {
      this.next();
      const inner = this.parseComparison();
      const close = this.expect(")", "a closing parenthesis");
      return { ...inner, pos: this.span(t.pos, close.pos) };
    }

    if (t.type === "number") {
      this.next();
      return { kind: "literal", value: t.value as number, type: "number", pos: t.pos };
    }

    if (t.type === "string") {
      this.next();
      return { kind: "literal", value: t.value as string, type: "text", pos: t.pos };
    }

    if (t.type === "ident") {
      const upper = t.text.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        this.next();
        return { kind: "literal", value: upper === "TRUE", type: "boolean", pos: t.pos };
      }
      if (upper === "NULL") {
        this.next();
        return { kind: "literal", value: null, type: "null", pos: t.pos };
      }
      this.next();
      if (this.peek().type === "(") {
        return this.parseCall(t);
      }
      return this.parseFieldPath(t);
    }

    throw new FormulaError(t.type === "eof" ? "This formula is incomplete." : `Unexpected "${t.text}".`, t.pos);
  }

  private parseCall(nameToken: Token): Expr {
    this.next(); // "("
    const args: Expr[] = [];
    if (this.peek().type !== ")") {
      args.push(this.parseComparison());
      while (this.peek().type === ",") {
        this.next();
        args.push(this.parseComparison());
      }
    }
    const close = this.expect(")", "a closing parenthesis");
    return { kind: "call", name: nameToken.text.toUpperCase(), args, pos: this.span(nameToken.pos, close.pos) };
  }

  private parseFieldPath(firstToken: Token): Expr {
    const path = [firstToken.text];
    let end = firstToken.pos;
    while (this.peek().type === ".") {
      this.next();
      const seg = this.expect("ident", "a field name");
      path.push(seg.text);
      end = seg.pos;
    }
    return { kind: "field", path, pos: this.span(firstToken.pos, end) };
  }
}

/** Parses formula source into an AST. Throws FormulaError (with a position) on anything invalid. */
export function parse(source: string): Expr {
  return new Parser(tokenize(source)).parseProgram();
}
