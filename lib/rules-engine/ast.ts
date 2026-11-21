import type { FormulaType, FormulaValue, Position } from "./types";

/**
 * The AST a formula compiles to. Plain data — JSON-serializable as-is (stored alongside the source
 * text), and the only thing the evaluator ever walks. There is no "exec" node: every node is one of
 * these five shapes, so there is no way for stored JSON to smuggle in behaviour.
 */

export type BinaryOp = "+" | "-" | "*" | "/" | "&" | "=" | "!=" | "<" | "<=" | ">" | ">=";

export type Expr =
  | { kind: "literal"; value: FormulaValue; type: FormulaType; pos: Position }
  | { kind: "field"; path: string[]; pos: Position }
  | { kind: "call"; name: string; args: Expr[]; pos: Position }
  | { kind: "unary"; op: "-"; expr: Expr; pos: Position }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr; pos: Position };
