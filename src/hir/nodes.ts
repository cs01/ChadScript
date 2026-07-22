// HIR: the compiler's own intermediate representation, produced by lower/ and consumed by
// codegen/. Crucially, this module does NOT import `typescript` — HIR is fully decoupled from
// the frontend. Every expression node carries its resolved `ValueType`; the backend reads that
// field and never re-derives a type.

import type { ValueType } from "./types.js";

export interface HModule {
  statements: HStmt[];
}

export type HStmt =
  | { kind: "consoleLog"; value: HExpr }
  | { kind: "processExit"; code: HExpr }
  // A `let`/`const` binding with an initializer. `name` is unique per module (Phase 1 has a
  // single scope — the entry function). `type` is the variable's resolved type.
  | { kind: "varDecl"; name: string; init: HExpr; type: ValueType };

export type UnaryOp = "neg" | "pos";
// Arithmetic ops produce a number; comparison ops (lt..ne) produce a boolean. The `type`
// field on the binary node records which — lower/ stamps it from the checker.
export type BinaryOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "rem"
  | "lt"
  | "gt"
  | "le"
  | "ge"
  | "eq"
  | "ne";

export type HExpr =
  | { kind: "numberLit"; value: number; type: ValueType }
  | { kind: "stringLit"; value: string; type: ValueType }
  | { kind: "boolLit"; value: boolean; type: ValueType }
  | { kind: "varRef"; name: string; type: ValueType }
  | { kind: "unary"; op: UnaryOp; operand: HExpr; type: ValueType }
  | { kind: "binary"; op: BinaryOp; left: HExpr; right: HExpr; type: ValueType };
