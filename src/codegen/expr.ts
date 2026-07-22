// Expression lowering: HExpr → IR Value. Consumes HIR only — NO `typescript` import, no
// checker. Each HExpr already carries its resolved ValueType (stamped by lower/), so dispatch
// is on the HIR shape alone. JS number arithmetic is IEEE-754 f64, so the number domain maps
// straight to LLVM float instructions.

import { ice } from "../diagnostics.js";
import {
  fimm,
  imm,
  type Value,
  type ModuleBuilder,
  type FuncBuilder,
  type BasicBlock,
} from "../ir/builder.js";
import { T, type IrType } from "../ir/types.js";
import type { HExpr, BinaryOp } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";

export interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
  // Live variable slots: name → its stack pointer + resolved type.
  vars: Map<string, { ptr: Value; vtype: ValueType }>;
  // `break` targets (pushed by loops AND switch); `continue` targets (loops only, so continue
  // inside a switch correctly reaches the enclosing loop). Innermost last.
  breakTargets: BasicBlock[];
  continueTargets: BasicBlock[];
}

// The machine representation of a source-level type.
export function irTypeOf(vt: ValueType): IrType {
  switch (vt.kind) {
    case "number":
      return T.double;
    case "boolean":
      return T.i1;
    case "string":
      return T.ptr;
    case "array":
      return T.ptr; // pointer to the runtime array struct
    case "object":
      return T.ptr; // pointer to the GC record of field slots
    case "optional":
      return T.ptr; // the undefined sentinel, or a pointer to a boxed inner value
    case "null":
    case "undefined":
      return ice(`irTypeOf: ${vt.kind} has no storage representation yet`);
    default:
      return ice(`irTypeOf: unhandled ValueType ${(vt as { kind: string }).kind}`);
  }
}

// Box a value into a uniform 8-byte array slot (i64); unbox reverses it. Element boxing is
// per-type; only number is wired now (string[]/boolean[] land next).
export function boxSlot(v: Value, elemType: ValueType, ctx: Ctx): Value {
  switch (elemType.kind) {
    case "number":
      return ctx.fn.bitcastDoubleToI64(v);
    case "string":
    case "array":
    case "object":
    case "optional":
      return ctx.fn.ptrToI64(v); // all pointer-represented
    case "boolean":
      return ctx.fn.zextI1ToI64(v);
    default:
      return ice(`slot boxing not supported for ${elemType.kind} yet`);
  }
}

function unboxSlot(slot: Value, elemType: ValueType, ctx: Ctx): Value {
  switch (elemType.kind) {
    case "number":
      return ctx.fn.bitcastI64ToDouble(slot);
    case "string":
    case "array":
    case "object":
    case "optional":
      return ctx.fn.i64ToPtr(slot);
    case "boolean":
      return ctx.fn.truncI64ToI1(slot);
    default:
      return ice(`slot unboxing not supported for ${elemType.kind} yet`);
  }
}

// Evaluate an object-typed HExpr to a ptr (to the GC record of i64 field slots).
export function evalObjectPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "objectLit": {
      if (expr.type.kind !== "object") return ice("objectLit not object-typed");
      const fields = expr.type.shape.fields;
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, fields.length * 8)]);
      expr.fields.forEach((f, i) => {
        const slot = boxSlot(evalValue(f, ctx), fields[i]!.type, ctx);
        ctx.fn.store(slot, ctx.fn.gepSlot(rec, i));
      });
      return rec;
    }
    case "new": {
      // Allocate the record, run the constructor (which sets fields via memberSet on `this`),
      // then the record is the value of the `new` expression.
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, expr.fieldCount * 8)]);
      const args = expr.args.map((a) => evalValue(a, ctx));
      ctx.fn.callVoid(`@${expr.className}.constructor`, [rec, ...args]);
      return rec;
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    default:
      return ice(`evalObjectPtr: unhandled object expression ${expr.kind}`);
  }
}

// Read `obj.field`: load the field's i64 slot and unbox it to the field type.
export function evalMemberGet(expr: Extract<HExpr, { kind: "memberGet" }>, ctx: Ctx): Value {
  const obj = evalObjectPtr(expr.object, ctx);
  const raw = ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, expr.slot));
  return unboxSlot(raw, expr.type, ctx);
}

// Evaluate an optional-typed HExpr to its pointer rep (undefined sentinel, or a box pointer).
export function evalOptionalPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "index") return evalIndex(expr, ctx);
  if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
  if (expr.kind === "arrayPop")
    return ctx.fn.call(`@${expr.fn}`, T.ptr, [evalArrayPtr(expr.array, ctx)]);
  if (expr.kind === "memberGet") return evalMemberGet(expr, ctx); // an optional field
  if (expr.kind === "wrap") return evalWrap(expr, ctx);
  if (expr.kind === "undefinedOpt") return ctx.mod.externGlobal("cs_undefined_marker");
  if (expr.kind === "call") return evalCall(expr, ctx);
  if (expr.kind === "coalesce") return evalCoalesce(expr, ctx);
  return ice(`evalOptionalPtr: unhandled optional expression ${expr.kind}`);
}

// Wrap an inner value into a present optional: a GC box holding the boxed inner value.
function evalWrap(expr: Extract<HExpr, { kind: "wrap" }>, ctx: Ctx): Value {
  const inner = expr.type.kind === "optional" ? expr.type.inner : ice("wrap: not optional-typed");
  const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(boxSlot(evalValue(expr.value, ctx), inner, ctx), box);
  return box;
}

// `arr[i]` → `element | undefined`, bounds-checked. In range: box the element; out of range: the
// undefined sentinel.
function evalIndex(expr: Extract<HExpr, { kind: "index" }>, ctx: Ctx): Value {
  const arr = evalArrayPtr(expr.array, ctx);
  const i = ctx.fn.fptosi_i32(evalNumber(expr.index, ctx));
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  const result = ctx.fn.alloca(T.ptr);

  const checkUpper = ctx.fn.newBlock("idx.check");
  const inB = ctx.fn.newBlock("idx.in");
  const outB = ctx.fn.newBlock("idx.out");
  const endB = ctx.fn.newBlock("idx.end");

  ctx.fn.brCond(ctx.fn.icmp("sge", i, imm(T.i32, 0)), checkUpper, outB);
  ctx.fn.switchTo(checkUpper);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), inB, outB);

  ctx.fn.switchTo(inB);
  const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), box); // store the raw i64 slot
  ctx.fn.store(box, result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(outB);
  ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// Unbox a present optional pointer (a box) to its inner value.
export function unboxOptionalValue(optPtr: Value, innerType: ValueType, ctx: Ctx): Value {
  return unboxSlot(ctx.fn.load(T.i64, optPtr), innerType, ctx);
}

// Unwrap a narrowed optional (proven present by an `x !== undefined` guard): load its box and
// unbox to the inner type.
export function evalUnwrap(expr: Extract<HExpr, { kind: "unwrap" }>, ctx: Ctx): Value {
  return unboxOptionalValue(evalOptionalPtr(expr.value, ctx), expr.type, ctx);
}

// `x === undefined` / `x !== undefined` → i1 (compare the optional pointer to the sentinel).
export function evalNullCheck(expr: Extract<HExpr, { kind: "nullCheck" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.value, ctx);
  const sentinel = ctx.mod.externGlobal("cs_undefined_marker");
  return ctx.fn.icmp(expr.isEqual ? "eq" : "ne", opt, sentinel);
}

// `a ?? b`: if `a` is the undefined sentinel, use `b`; else unwrap the boxed inner value.
export function evalCoalesce(expr: Extract<HExpr, { kind: "coalesce" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.left, ctx);
  const isUndef = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker"));
  const result = ctx.fn.alloca(irTypeOf(expr.type));

  const defB = ctx.fn.newBlock("nn.default");
  const presentB = ctx.fn.newBlock("nn.present");
  const endB = ctx.fn.newBlock("nn.end");

  ctx.fn.brCond(isUndef, defB, presentB);
  ctx.fn.switchTo(defB);
  ctx.fn.store(evalValue(expr.right, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(presentB);
  ctx.fn.store(unboxSlot(ctx.fn.load(T.i64, opt), expr.type, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(irTypeOf(expr.type), result);
}

// Evaluate an array-typed HExpr to a ptr (to the runtime array struct).
export function evalArrayPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "arrayLit": {
      const arr = ctx.fn.call("@cs_array_new", T.ptr, []);
      const elemType = expr.type.kind === "array" ? expr.type.element : ice("arrayLit not array");
      for (const el of expr.elements) {
        ctx.fn.call("@cs_array_push", T.i32, [arr, boxSlot(evalValue(el, ctx), elemType, ctx)]);
      }
      return arr;
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "strMethod":
      return evalStrMethod(expr, ctx); // e.g. "a,b".split(",")
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    default:
      return ice(`evalArrayPtr: unhandled array expression ${expr.kind}`);
  }
}

// Load one element out of an array pointer at index `i` (i32), unboxed to `elemType`.
export function arrayElementAt(arr: Value, i: Value, elemType: ValueType, ctx: Ctx): Value {
  return unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elemType, ctx);
}

export function lookupVar(name: string, ctx: Ctx): { ptr: Value; vtype: ValueType } {
  const slot = ctx.vars.get(name);
  if (!slot) ice(`codegen: reference to unbound variable ${name}`);
  return slot;
}

// A value-returning call: evaluate each argument to a Value, then call. The callee's IR name
// is its HIR name; the return IR type comes from the call's resolved (non-void) type.
export function evalCall(expr: Extract<HExpr, { kind: "call" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalValue(a, ctx));
  return ctx.fn.call(`@${expr.name}`, irTypeOf(expr.type), args);
}

// Math.* → libm (floor/ceil/trunc/sqrt/fabs/pow) or a runtime helper (round/sign, whose JS
// semantics differ from C). All operate on doubles.
const MATH_UNARY: Record<string, string> = {
  floor: "@floor",
  ceil: "@ceil",
  trunc: "@trunc",
  abs: "@fabs",
  sqrt: "@sqrt",
  round: "@cs_math_round",
  sign: "@cs_math_sign",
};

export function evalMathCall(expr: Extract<HExpr, { kind: "mathCall" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalNumber(a, ctx));
  const unary = MATH_UNARY[expr.fn];
  if (unary) return ctx.fn.call(unary, T.double, [args[0]!]);
  if (expr.fn === "pow") return ctx.fn.call("@pow", T.double, [args[0]!, args[1]!]);
  return ice(`codegen: Math.${expr.fn} not supported yet`);
}

// String methods: each maps to a runtime call. `ret` picks the IR return type and any bool
// conversion (the runtime returns i32 0/1 for predicates).
type StrRet = "string" | "number" | "bool" | "array";
const STR_METHODS: Record<string, { fn: string; ret: StrRet }> = {
  toUpperCase: { fn: "@cs_str_upper", ret: "string" },
  toLowerCase: { fn: "@cs_str_lower", ret: "string" },
  trim: { fn: "@cs_str_trim", ret: "string" },
  repeat: { fn: "@cs_str_repeat", ret: "string" },
  charAt: { fn: "@cs_str_char_at", ret: "string" },
  replace: { fn: "@cs_str_replace", ret: "string" },
  split: { fn: "@cs_str_split", ret: "array" },
  includes: { fn: "@cs_str_includes", ret: "bool" },
  startsWith: { fn: "@cs_str_starts_with", ret: "bool" },
  endsWith: { fn: "@cs_str_ends_with", ret: "bool" },
  indexOf: { fn: "@cs_str_index_of", ret: "number" },
};

function strRetIrType(ret: StrRet) {
  return ret === "number" ? T.double : ret === "bool" ? T.i32 : T.ptr;
}

export function evalStrMethod(expr: Extract<HExpr, { kind: "strMethod" }>, ctx: Ctx): Value {
  const recv = evalString(expr.receiver, ctx);
  const args = expr.args.map((a) => evalValue(a, ctx));

  // slice has 1-or-2-arg forms with different runtime entry points (the second arg defaults to
  // the string length inside slice1).
  if (expr.method === "slice") {
    const fn = args.length >= 2 ? "@cs_str_slice2" : "@cs_str_slice1";
    return ctx.fn.call(fn, T.ptr, [recv, ...args]);
  }

  const m = STR_METHODS[expr.method];
  if (!m) return ice(`codegen: string method .${expr.method} not supported yet`);
  const raw = ctx.fn.call(m.fn, strRetIrType(m.ret), [recv, ...args]);
  // Predicates return i32 0/1 — narrow to i1.
  return m.ret === "bool" ? ctx.fn.icmp("ne", raw, imm(T.i32, 0)) : raw;
}

// Evaluate any supported HExpr to an IR Value, dispatched on its resolved type.
export function evalValue(expr: HExpr, ctx: Ctx): Value {
  switch (expr.type.kind) {
    case "number":
      return evalNumber(expr, ctx);
    case "boolean":
      return evalBool(expr, ctx);
    case "string":
      return evalString(expr, ctx);
    case "array":
      return evalArrayPtr(expr, ctx);
    case "object":
      return evalObjectPtr(expr, ctx);
    case "optional":
      return evalOptionalPtr(expr, ctx);
    default:
      return ice(`evalValue: ${expr.type.kind} not supported yet`);
  }
}

// Evaluate a string-typed HExpr to a ptr Value (cstring for a literal; a load for a varRef).
export function evalString(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "stringLit":
      return ctx.mod.cstring(expr.value);
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "logical":
      return evalLogical(expr, ctx);
    case "binary":
      // The only string-producing binary is `+` (concatenation); each operand is coerced.
      if (expr.op === "add") {
        return ctx.fn.call("@cs_str_concat", T.ptr, [
          coerceToString(expr.left, ctx),
          coerceToString(expr.right, ctx),
        ]);
      }
      return ice(`evalString: binary op ${expr.op} does not produce a string`);
    case "template":
      return evalTemplate(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "strMethod":
      return evalStrMethod(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    default:
      return ice(`evalString: unhandled string expression ${expr.kind}`);
  }
}

// Coerce any supported value to its JS string form (a ptr). Numbers use Number::toString (so
// `"" + -0` is "0", unlike console.log(-0)); booleans → "true"/"false"; strings pass through.
function coerceToString(expr: HExpr, ctx: Ctx): Value {
  switch (expr.type.kind) {
    case "string":
      return evalString(expr, ctx);
    case "number":
      return ctx.fn.call("@cs_num_to_string", T.ptr, [evalNumber(expr, ctx)]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(evalBool(expr, ctx))]);
    default:
      return ice(`coerceToString: ${expr.type.kind} not supported yet`);
  }
}

// A template literal: fold quasis and interpolations left-to-right with concatenation.
function evalTemplate(expr: Extract<HExpr, { kind: "template" }>, ctx: Ctx): Value {
  let acc = ctx.mod.cstring(expr.quasis[0]!);
  for (let i = 0; i < expr.exprs.length; i++) {
    acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, coerceToString(expr.exprs[i]!, ctx)]);
    acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, ctx.mod.cstring(expr.quasis[i + 1]!)]);
  }
  return acc;
}

const RELATIONAL: Partial<Record<BinaryOp, string>> = {
  lt: "olt",
  gt: "ogt",
  le: "ole",
  ge: "oge",
};

// Evaluate a number-typed HExpr to a double Value.
export function evalNumber(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "numberLit":
      return fimm(expr.value);

    case "varRef":
      return ctx.fn.load(T.double, lookupVar(expr.name, ctx).ptr);

    case "call":
      return evalCall(expr, ctx);

    case "mathCall":
      return evalMathCall(expr, ctx);

    case "strLen":
      return ctx.fn.sitofp(ctx.fn.call("@cs_str_len", T.i32, [evalString(expr.str, ctx)]));

    case "strMethod":
      return evalStrMethod(expr, ctx);

    case "coalesce":
      return evalCoalesce(expr, ctx);

    case "unwrap":
      return evalUnwrap(expr, ctx);

    case "arrayLen":
      // JS .length is a number; the runtime returns an i32 count.
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_len", T.i32, [evalArrayPtr(expr.array, ctx)]));

    case "arrayPush": {
      // push returns the new length (a number). Box the value into a slot first.
      const arr = evalArrayPtr(expr.array, ctx);
      const slot = boxSlot(evalValue(expr.value, ctx), expr.elementType, ctx);
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_push", T.i32, [arr, slot]));
    }

    case "memberGet":
      return evalMemberGet(expr, ctx);

    case "logical":
      return evalLogical(expr, ctx);

    case "unary": {
      const op = expr.op;
      switch (op) {
        case "neg":
          return ctx.fn.fneg(evalNumber(expr.operand, ctx));
        case "pos":
          return evalNumber(expr.operand, ctx); // unary + on a number is identity
        case "bnot":
          // ~a = ToInt32(a) ^ -1, back to double.
          return ctx.fn.sitofp(ctx.fn.ixor(toInt32(expr.operand, ctx), imm(T.i32, -1)));
        default:
          return ice(`evalNumber: unhandled unary op ${op} in number domain`);
      }
    }

    case "binary":
      return evalArithOrBitwise(expr, ctx);

    case "boolLit":
    case "stringLit":
      return ice(`evalNumber: got a ${expr.kind} in the number domain`);

    default:
      return ice(`evalNumber: unhandled expression ${(expr as { kind: string }).kind}`);
  }
}

// A number-typed binary op: floating arithmetic, or JS int32 bitwise/shift.
function evalArithOrBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  switch (expr.op) {
    case "add":
      return ctx.fn.fadd(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "sub":
      return ctx.fn.fsub(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "mul":
      return ctx.fn.fmul(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "div":
      return ctx.fn.fdiv(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "rem":
      return ctx.fn.frem(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    default:
      return evalBitwise(expr, ctx);
  }
}

// JS int32 bitwise/shift ops. Both operands go through ToInt32; shifts mask the count to 5
// bits; the result reinterprets the 32 bits back to a double (signed, except `>>>` unsigned).
function evalBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const ai = toInt32(expr.left, ctx);
  const bi = toInt32(expr.right, ctx);
  const count = () => ctx.fn.iand(bi, imm(T.i32, 31)); // JS masks shift count to 0..31
  switch (expr.op) {
    case "band":
      return ctx.fn.sitofp(ctx.fn.iand(ai, bi));
    case "bor":
      return ctx.fn.sitofp(ctx.fn.ior(ai, bi));
    case "bxor":
      return ctx.fn.sitofp(ctx.fn.ixor(ai, bi));
    case "shl":
      return ctx.fn.sitofp(ctx.fn.shl(ai, count()));
    case "shr":
      return ctx.fn.sitofp(ctx.fn.ashr(ai, count())); // arithmetic (sign-propagating)
    case "ushr":
      return ctx.fn.uitofp(ctx.fn.lshr(ai, count())); // logical; result is unsigned
    default:
      return ice(`evalBitwise: not a bitwise op: ${expr.op}`);
  }
}

// ToInt32(expr): evaluate to a double, then coerce via the runtime helper to an i32.
function toInt32(expr: HExpr, ctx: Ctx): Value {
  return ctx.fn.call("@cs_to_int32", T.i32, [evalNumber(expr, ctx)]);
}

// JS truthiness of an expression → i1 (evaluates the expression once).
export function toBool(expr: HExpr, ctx: Ctx): Value {
  return truthyOfValue(evalValue(expr, ctx), expr.type, ctx);
}

// JS truthiness of an ALREADY-computed Value → i1. Used where re-evaluating the expression
// would repeat side effects (e.g. the left operand of &&/||). Matches JS: number truthy iff
// != 0 and not NaN (ordered `one` vs 0 is false for both 0 and NaN); boolean is itself.
export function truthyOfValue(v: Value, vt: ValueType, ctx: Ctx): Value {
  switch (vt.kind) {
    case "boolean":
      return v;
    case "number":
      return ctx.fn.fcmp("one", v, fimm(0));
    case "string":
      return ice("truthiness: string truthiness not supported yet");
    default:
      return ice(`truthiness: ${vt.kind} not supported yet`);
  }
}

// Short-circuiting `&&` / `||` with JS value semantics: the result is one of the operands.
// Implemented with a result slot (mem2reg promotes it to a phi at -O2), so the right operand
// is evaluated only when the left doesn't decide the outcome.
export function evalLogical(expr: Extract<HExpr, { kind: "logical" }>, ctx: Ctx): Value {
  const irt = irTypeOf(expr.type);
  const slot = ctx.fn.alloca(irt);
  const leftVal = evalValue(expr.left, ctx);
  ctx.fn.store(leftVal, slot); // default result = left
  const leftTruthy = truthyOfValue(leftVal, expr.left.type, ctx);

  const rightB = ctx.fn.newBlock("logic.right");
  const doneB = ctx.fn.newBlock("logic.done");
  // `&&`: evaluate right only if left is truthy. `||`: only if left is falsy.
  if (expr.op === "and") ctx.fn.brCond(leftTruthy, rightB, doneB);
  else ctx.fn.brCond(leftTruthy, doneB, rightB);

  ctx.fn.switchTo(rightB);
  ctx.fn.store(evalValue(expr.right, ctx), slot); // result = right
  ctx.fn.br(doneB);

  ctx.fn.switchTo(doneB);
  return ctx.fn.load(irt, slot);
}

// Evaluate a boolean-typed HExpr to an i1 Value.
export function evalBool(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "boolLit":
      return imm(T.i1, expr.value ? 1 : 0);

    case "varRef":
      return ctx.fn.load(T.i1, lookupVar(expr.name, ctx).ptr);

    case "call":
      return evalCall(expr, ctx);

    case "logical":
      return evalLogical(expr, ctx);

    case "unary":
      // Only `!` produces a boolean here (neg/pos live in the number domain).
      if (expr.op === "not") return ctx.fn.logicalNot(toBool(expr.operand, ctx));
      return ice(`evalBool: unary op ${expr.op} does not produce a boolean`);

    case "binary":
      return evalComparison(expr, ctx);

    case "memberGet":
      return evalMemberGet(expr, ctx);

    case "strMethod":
      return evalStrMethod(expr, ctx);

    case "coalesce":
      return evalCoalesce(expr, ctx);

    case "unwrap":
      return evalUnwrap(expr, ctx);

    case "nullCheck":
      return evalNullCheck(expr, ctx);

    default:
      return ice(`evalBool: unhandled boolean expression ${expr.kind}`);
  }
}

function evalComparison(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const op = expr.op;
  const relPred = RELATIONAL[op];
  if (relPred) {
    // Relational operands are numbers (JS forbids `<` on booleans). Ordered predicate → NaN
    // yields false, matching JS.
    return ctx.fn.fcmp(relPred, evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
  }
  if (op === "eq" || op === "ne") {
    const operandType = expr.left.type.kind;
    if (operandType === "number") {
      // === → oeq (NaN===NaN false); !== → une (= !oeq, so NaN!==NaN true). Using ordered
      // `one` for !== would wrongly make NaN!==NaN false — a JS divergence.
      return ctx.fn.fcmp(
        op === "eq" ? "oeq" : "une",
        evalNumber(expr.left, ctx),
        evalNumber(expr.right, ctx),
      );
    }
    if (operandType === "boolean") {
      return ctx.fn.icmp(
        op === "eq" ? "eq" : "ne",
        evalBool(expr.left, ctx),
        evalBool(expr.right, ctx),
      );
    }
    return ice(`evalBool: ${op} on ${operandType} operands not supported yet`);
  }
  return ice(`evalBool: binary op ${op} is not a comparison`);
}
