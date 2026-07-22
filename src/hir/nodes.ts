// HIR: the compiler's own intermediate representation, produced by lower/ and consumed by
// codegen/. Crucially, this module does NOT import `typescript` — HIR is fully decoupled from
// the frontend. Every expression node carries its resolved `ValueType`; the backend reads that
// field and never re-derives a type.

import type { ValueType } from "./types.js";

export interface HModule {
  functions: HFunc[];
  // Top-level statements — lowered into the synthesized `main` entry function.
  topLevel: HStmt[];
}

export interface HParam {
  name: string;
  type: ValueType;
}

export interface HFunc {
  name: string; // unique HIR name (symbol-resolved), used as the LLVM function name
  params: HParam[];
  returnType: ValueType | null; // null = void
  body: HStmt[];
}

export type HStmt =
  // console.log of zero or more values, printed space-separated with a trailing newline.
  | { kind: "consoleLog"; values: HExpr[] }
  | { kind: "processExit"; code: HExpr }
  // A `let`/`const` binding with an initializer. `name` is unique per module (Phase 1 has a
  // single scope — the entry function). `type` is the variable's resolved type.
  | { kind: "varDecl"; name: string; init: HExpr; type: ValueType }
  // Reassignment to an existing `let` binding (const reassignment is blocked by the tsc gate).
  // Compound assignment (`+=` etc.) is lowered to `value = <var> <op> rhs`.
  | { kind: "assign"; name: string; value: HExpr }
  // `obj.field = value` write. `slot` is the field's record index.
  | { kind: "memberSet"; object: HExpr; slot: number; value: HExpr }
  // `if (cond) { then } else { otherwise }`. `otherwise` is null when there is no else.
  // `cond` is evaluated for JS truthiness (see codegen toBool).
  | { kind: "if"; cond: HExpr; then: HStmt[]; otherwise: HStmt[] | null }
  // `while (cond) { body }` — cond re-evaluated (truthiness) before each iteration.
  | { kind: "while"; cond: HExpr; body: HStmt[] }
  // `for (init; cond; update) { body }`. `cond` null means an always-true loop. init/update
  // are statement lists (a decl or assignment). The update block is kept distinct from the body
  // so `continue` can target it once supported.
  | { kind: "for"; init: HStmt[]; cond: HExpr | null; update: HStmt[]; body: HStmt[] }
  // `for (const name of array) { body }`. Binds `name` (type `elementType`) to each element.
  | { kind: "forOf"; name: string; elementType: ValueType; array: HExpr; body: HStmt[] }
  // `return expr;` (value null for a bare `return;` in a void function).
  | { kind: "return"; value: HExpr | null }
  // `break;` / `continue;` — target the innermost enclosing loop (no labels yet).
  | { kind: "break" }
  | { kind: "continue" }
  // `switch (disc) { ... }`. Cases in source order; a case with `test === null` is `default`.
  // Bodies fall through to the next case unless they break/return (JS semantics). `discType` is
  // the discriminant's type (cases are matched with `===`).
  | { kind: "switch"; disc: HExpr; discType: ValueType; cases: HCase[] }
  // A call in statement position — result discarded. `returnType` null means a void function.
  | { kind: "callStmt"; name: string; args: HExpr[]; returnType: ValueType | null }
  // An expression evaluated for its side effects only, result discarded (e.g. `arr.push(x);`).
  | { kind: "exprStmt"; expr: HExpr };

export interface HCase {
  test: HExpr | null; // null = the `default` clause
  body: HStmt[];
}

export type UnaryOp = "neg" | "pos" | "not" | "bnot";
export type LogicalOp = "and" | "or";
// Arithmetic + bitwise ops produce a number; comparison ops (lt..ne) produce a boolean. The
// `type` field on the binary node records which — lower/ stamps it from the checker.
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
  | "ne"
  // Bitwise / shift (JS int32 semantics; `ushr` is the unsigned `>>>`).
  | "band"
  | "bor"
  | "bxor"
  | "shl"
  | "shr"
  | "ushr";

export type HExpr =
  | { kind: "numberLit"; value: number; type: ValueType }
  | { kind: "stringLit"; value: string; type: ValueType }
  | { kind: "boolLit"; value: boolean; type: ValueType }
  | { kind: "varRef"; name: string; type: ValueType }
  // Call to a user function by its resolved HIR name. `type` is the return type.
  | { kind: "call"; name: string; args: HExpr[]; type: ValueType }
  // A `Math.*` builtin call (number-valued). `fn` is the method name (floor/sqrt/pow/...).
  | { kind: "mathCall"; fn: string; args: HExpr[]; type: ValueType }
  // `str.length` → number.
  | { kind: "strLen"; str: HExpr; type: ValueType }
  // A `string.method(args)` builtin. `method` is the JS name; result type is `type`.
  | { kind: "strMethod"; method: string; receiver: HExpr; args: HExpr[]; type: ValueType }
  // Array literal `[a, b, ...]`. `type` is the array type; each element is boxed per element type.
  | { kind: "arrayLit"; elements: HExpr[]; type: ValueType }
  // `arr.length` → number.
  | { kind: "arrayLen"; array: HExpr; type: ValueType }
  // `arr[i]` index access → `element | undefined` (bounds-checked). `type` is the optional type.
  | { kind: "index"; array: HExpr; index: HExpr; elementType: ValueType; type: ValueType }
  // `a ?? b`: if `a` is undefined, evaluate `b`; else unwrap `a`. `type` is the (non-optional)
  // result type.
  | { kind: "coalesce"; left: HExpr; right: HExpr; type: ValueType }
  // `arr.push(value)` → the new length (number). `elementType` says how to box the value.
  | { kind: "arrayPush"; array: HExpr; value: HExpr; elementType: ValueType; type: ValueType }
  // Object literal `{ f: v, ... }`. `fields` are in SHAPE (record-slot) order — lower reorders
  // the source properties to match the declared shape.
  | { kind: "objectLit"; fields: HExpr[]; type: ValueType }
  // `obj.field` read. `slot` is the field's record index; `type` is the field's type.
  | { kind: "memberGet"; object: HExpr; slot: number; type: ValueType }
  // `new Class(args)`: allocate the record, run `Class.constructor(record, args)`, yield the
  // record. `fieldCount` sizes the allocation.
  | { kind: "new"; className: string; fieldCount: number; args: HExpr[]; type: ValueType }
  | { kind: "unary"; op: UnaryOp; operand: HExpr; type: ValueType }
  | { kind: "binary"; op: BinaryOp; left: HExpr; right: HExpr; type: ValueType }
  // Short-circuiting `&&` / `||`. JS VALUE semantics: the result IS one of the operands (not a
  // coerced boolean), so `type` is the operands' shared type. right is evaluated only when the
  // left operand doesn't decide the result.
  | { kind: "logical"; op: LogicalOp; left: HExpr; right: HExpr; type: ValueType }
  // A template literal. `quasis` are the literal text chunks; `exprs` the interpolations. Always
  // `quasis.length === exprs.length + 1`. Interpolated values are coerced to string. Result is
  // a string.
  | { kind: "template"; quasis: string[]; exprs: HExpr[]; type: ValueType };
