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
  | { kind: "varDecl"; name: string; init: HExpr; type: ValueType }
  // Reassignment to an existing `let` binding (const reassignment is blocked by the tsc gate).
  // Compound assignment (`+=` etc.) is lowered to `value = <var> <op> rhs`.
  | { kind: "assign"; name: string; value: HExpr }
  // `if (cond) { then } else { otherwise }`. `otherwise` is null when there is no else.
  // `cond` is evaluated for JS truthiness (see codegen toBool).
  | { kind: "if"; cond: HExpr; then: HStmt[]; otherwise: HStmt[] | null }
  // `while (cond) { body }` — cond re-evaluated (truthiness) before each iteration.
  | { kind: "while"; cond: HExpr; body: HStmt[] }
  // `for (init; cond; update) { body }`. `cond` null means an always-true loop. init/update
  // are statement lists (a decl or assignment). The update block is kept distinct from the body
  // so `continue` can target it once supported.
  | { kind: "for"; init: HStmt[]; cond: HExpr | null; update: HStmt[]; body: HStmt[] };

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
