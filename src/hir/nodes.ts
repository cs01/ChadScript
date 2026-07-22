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

export interface HCapture {
  name: string; // the HIR name of the captured variable (from the enclosing scope)
  type: ValueType;
}

export interface HFunc {
  name: string; // unique HIR name (symbol-resolved), used as the LLVM function name
  params: HParam[];
  returnType: ValueType | null; // null = void
  body: HStmt[];
  // A lifted lambda takes a hidden `env` pointer as its first LLVM parameter and binds these
  // captured variables from it at entry. Empty/undefined for ordinary functions.
  captures?: HCapture[];
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

// One entry in an array literal. `spread` true → `value` is an array whose elements are copied
// in (`...src`); false → `value` is a single element.
export interface ArrayElement {
  spread: boolean;
  value: HExpr;
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
  // A direct call to a runtime C entry point (e.g. cs_parse_int). `fn` is the FULL symbol name;
  // args are evaluated left-to-right and passed as-is. `type` is the return type.
  | { kind: "runtimeCall"; fn: string; args: HExpr[]; type: ValueType }
  // Create a closure: the lifted lambda `lambdaName` plus a captured-variable environment.
  | { kind: "closure"; lambdaName: string; captures: HCapture[]; type: ValueType }
  // Call a function VALUE (closure): load its fnptr + env and invoke. `type` is the return type.
  | { kind: "callClosure"; callee: HExpr; args: HExpr[]; type: ValueType }
  // Ternary `cond ? whenTrue : whenFalse`. Both arms share the result `type` (tsc's common type).
  | { kind: "conditional"; cond: HExpr; whenTrue: HExpr; whenFalse: HExpr; type: ValueType }
  // `str.length` → number.
  | { kind: "strLen"; str: HExpr; type: ValueType }
  // A `string.method(args)` builtin. `method` is the JS name; result type is `type`.
  | { kind: "strMethod"; method: string; receiver: HExpr; args: HExpr[]; type: ValueType }
  // Array literal `[a, ...b, c]`. Each element is either a single value or a `...spread` of an
  // array-typed source (whose slots are copied in). `type` is the array type.
  | { kind: "arrayLit"; elements: ArrayElement[]; type: ValueType }
  // `arr.length` → number.
  | { kind: "arrayLen"; array: HExpr; type: ValueType }
  // `arr[i]` index access → `element | undefined` (bounds-checked). `type` is the optional type.
  | { kind: "index"; array: HExpr; index: HExpr; elementType: ValueType; type: ValueType }
  // `a ?? b`: if `a` is undefined, evaluate `b`; else unwrap `a`. `type` is the (non-optional)
  // result type.
  | { kind: "coalesce"; left: HExpr; right: HExpr; type: ValueType }
  // Unwrap a narrowed optional to its inner value. Emitted by lower when a var whose DECLARED
  // type is optional is used at a narrowed (non-optional) type (after `x !== undefined`).
  | { kind: "unwrap"; value: HExpr; type: ValueType }
  // `x === undefined` / `x !== undefined` → boolean (compares against the sentinel).
  // `x === null`/`x === undefined` (and `!==`). `sentinel` says which marker to compare against,
  // so `x === null` and `x === undefined` are distinguished for a `T | null | undefined` value.
  | {
      kind: "nullCheck";
      value: HExpr;
      isEqual: boolean;
      sentinel: "null" | "undefined";
      type: ValueType;
    }
  // Wrap an inner value into a present optional (a box). Used for `{ x: 5 }` where field x is
  // optional. `type` is the optional type.
  | { kind: "wrap"; value: HExpr; type: ValueType }
  // The `undefined` / `null` value of an optional type (the respective sentinel). undefinedOpt is
  // also used for an omitted optional field.
  | { kind: "undefinedOpt"; type: ValueType }
  | { kind: "nullOpt"; type: ValueType }
  // Bare `null` / `undefined` literals (type `null` / `undefined`). Only meaningful where the
  // context prints them (console.log) or coerces them into an optional; evalValue rejects them.
  | { kind: "nullLit"; type: ValueType }
  | { kind: "undefinedLit"; type: ValueType }
  // `arr.push(value)` → the new length (number). `elementType` says how to box the value.
  | { kind: "arrayPush"; array: HExpr; value: HExpr; elementType: ValueType; type: ValueType }
  // `arr.pop()` / `arr.shift()` → `element | undefined`. `fn` is the runtime entry point.
  | { kind: "arrayPop"; array: HExpr; fn: string; type: ValueType }
  // `arr.join(sep?)` → string. `separator` null means the default ",". Each element is coerced.
  | {
      kind: "arrayJoin";
      array: HExpr;
      separator: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
  // `arr.includes(x)` → boolean, `arr.indexOf(x)` → number. `wantIndex` distinguishes them.
  | {
      kind: "arraySearch";
      array: HExpr;
      value: HExpr;
      elementType: ValueType;
      wantIndex: boolean;
      type: ValueType;
    }
  // Array→array transforms that are a single runtime call (reverse/slice/concat). `fn` is the
  // runtime entry point; `args` are the extra arguments after the receiver.
  | { kind: "arrayXform"; fn: string; array: HExpr; args: HExpr[]; type: ValueType }
  // Map operations. `keyKind` (0 number / 1 string / 2 boolean) selects the runtime's key
  // equality. `mapNew` is `new Map()`; `mapGet` → `value | undefined`; `set` returns the map.
  | { kind: "mapNew"; type: ValueType }
  | { kind: "mapSet"; map: HExpr; key: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | {
      kind: "mapGet";
      map: HExpr;
      key: HExpr;
      keyKind: number;
      valueType: ValueType;
      type: ValueType;
    }
  | { kind: "mapHas"; map: HExpr; key: HExpr; keyKind: number; type: ValueType }
  | { kind: "mapDelete"; map: HExpr; key: HExpr; keyKind: number; type: ValueType }
  | { kind: "mapSize"; map: HExpr; type: ValueType }
  // Set operations. `keyKind` selects the runtime's element equality. `setNew` is `new Set()`;
  // `setFromArray` is `new Set(arr)`; `add` returns the set.
  | { kind: "setNew"; type: ValueType }
  | { kind: "setFromArray"; array: HExpr; keyKind: number; type: ValueType }
  | { kind: "setAdd"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setHas"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setDelete"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setSize"; set: HExpr; type: ValueType }
  // Materialize a Map/Set collection to a fresh array (in insertion order), so `for-of` and the
  // array methods work over it. `fn` is the runtime entry (cs_map_keys / cs_map_values /
  // cs_set_values); `receiver` is the map/set; `type` is the resulting array type.
  | { kind: "collectionToArray"; fn: string; receiver: HExpr; type: ValueType }
  // `arr.sort(cmp?)` — in-place insertion sort, returns the same array. `comparator` null means
  // JS default order (compare by String(element), lexicographic). `type` is the array type.
  | {
      kind: "arraySort";
      array: HExpr;
      comparator: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
  // Higher-order array methods that invoke a closure per element (map/filter/forEach/reduce).
  // Lowered to an inline IR loop that calls the callback closure; `init` is reduce's seed
  // (null → seed from the first element). `callback.type` is the closure's function type.
  | {
      kind: "arrayHof";
      op: "map" | "filter" | "forEach" | "reduce" | "find" | "findIndex" | "some" | "every";
      array: HExpr;
      callback: HExpr;
      init: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
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
