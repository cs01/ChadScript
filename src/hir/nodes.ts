// HIR: the compiler's own intermediate representation, produced by lower/ and consumed by
// codegen/. Crucially, this module does NOT import `typescript` — HIR is fully decoupled from
// the frontend. Every expression node carries its resolved `ValueType`; the backend reads that
// field and never re-derives a type.

import type { ValueType } from "./types.js";

export interface HModule {
  statements: HStmt[];
}

export type HStmt = { kind: "consoleLog"; value: HExpr } | { kind: "processExit"; code: HExpr };

export type UnaryOp = "neg" | "pos";
export type BinaryOp = "add" | "sub" | "mul" | "div" | "rem";

export type HExpr =
  | { kind: "numberLit"; value: number; type: ValueType }
  | { kind: "stringLit"; value: string; type: ValueType }
  | { kind: "unary"; op: UnaryOp; operand: HExpr; type: ValueType }
  | { kind: "binary"; op: BinaryOp; left: HExpr; right: HExpr; type: ValueType };
