// The `Value` encoding: one self-describing 64-bit word, used for every object field slot (and, in
// phase 4, for union / generic locals). The layout is defined here and in runtime/abi.milo
// (tests/unit/shape-abi.test.ts pins the two together):
//
//   v >= 2^49           a number: its IEEE-754 bits + 2^49 (mod 2^64). NaN is canonicalized to
//                       0x7FF8000000000000 first, so no double lands below 2^49 after the offset.
//   v == 0 / 1 / 2 / 3  undefined / null / false / true
//   otherwise           a pointer (>= 4096, 8-byte aligned, below 2^48) OR'ed with a 3-bit tag:
//                       0 object record, 1 string, 2 array, 3 function (closure), 4 Map, 5 Set,
//                       6 Promise, 7 other runtime handle (caught value, opaque handle).
//
// Why pointers are raw and doubles are offset (rather than doubles raw and pointers in the NaN
// space): the collector is Boehm, which scans conservatively and only recognizes a word that
// points into (or, with interior pointers on, anywhere inside) a heap block. A pointer hidden
// under NaN tag bits would be invisible to it and its object would be freed while still in use.
// A low 3-bit tag keeps the word an interior pointer, which Boehm recognizes (residue.c turns
// interior-pointer recognition on explicitly). `undefined` is 0 so a zeroed record reads as
// all-undefined, which is what a JS object's declared-but-unassigned class fields hold.

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type Ctx, boxSlot, unboxSlot, evalValue } from "./expr.js";
import { allocSlotBox } from "./alloc.js";

export const V_UNDEFINED = 0;
export const V_NULL = 1;
export const V_FALSE = 2;
export const V_TRUE = 3;
// 2^49 as a decimal literal (LLVM i64 immediates are decimal).
const DOUBLE_OFFSET = "562949953421312";
const PTR_MASK = -8; // clears the 3 tag bits

export const TAG = {
  object: 0,
  string: 1,
  array: 2,
  function: 3,
  map: 4,
  set: 5,
  promise: 6,
  other: 7,
} as const;

// The pointer tag for a pointer-represented type; null for the immediate and number kinds.
function pointerTag(type: ValueType): number | null {
  switch (type.kind) {
    case "object":
      return TAG.object;
    case "string":
      return TAG.string;
    case "array":
      return TAG.array;
    case "function":
      return TAG.function;
    case "map":
      return TAG.map;
    case "set":
      return TAG.set;
    case "promise":
      return TAG.promise;
    case "unknown":
    case "opaque":
      return TAG.other;
    case "number":
    case "boolean":
    case "null":
    case "undefined":
    case "optional":
    case "value":
      return null;
    default: {
      const never: never = type;
      return ice(`pointerTag: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// Evaluate `expr` and box it to a Value from its own type. `null`/`undefined` literals have no
// machine value of their own (evalValue rejects them), so they box straight to their constants.
export function evalBoxed(expr: HExpr, ctx: Ctx): Value {
  if (expr.type.kind === "null") return imm(T.i64, V_NULL);
  if (expr.type.kind === "undefined") return imm(T.i64, V_UNDEFINED);
  return boxValue(evalValue(expr, ctx), expr.type, ctx);
}

// Box an already-computed machine value of `type` to a Value.
export function boxValue(v: Value, type: ValueType, ctx: Ctx): Value {
  const tag = pointerTag(type);
  if (tag !== null) {
    const bits = ctx.fn.ptrToI64(v);
    return tag === 0 ? bits : ctx.fn.lor(bits, imm(T.i64, tag));
  }
  switch (type.kind) {
    case "number": {
      const isNan = ctx.fn.fcmp("uno", v, v);
      const canon = ctx.fn.select(isNan, fimm(NaN), v);
      return ctx.fn.ladd(ctx.fn.bitcastDoubleToI64(canon), imm(T.i64, DOUBLE_OFFSET));
    }
    case "boolean":
      return ctx.fn.lor(ctx.fn.zextI1ToI64(v), imm(T.i64, V_FALSE));
    case "optional":
      return boxOptional(v, type.inner, ctx);
    case "value":
      return v; // already a Value word
    default:
      return ice(`boxValue: ${type.kind} has no machine value to box`);
  }
}

// Unbox a Value to the machine representation of `type`. The caller's static type says which
// representation it wants; the Value itself is not checked (a static type that disagrees with the
// stored value is a soundness hole the validator must close, not something to repair here).
export function unboxValue(raw: Value, type: ValueType, ctx: Ctx): Value {
  if (pointerTag(type) !== null) return ctx.fn.i64ToPtr(ctx.fn.land(raw, imm(T.i64, PTR_MASK)));
  switch (type.kind) {
    case "number":
      return ctx.fn.bitcastI64ToDouble(ctx.fn.lsub(raw, imm(T.i64, DOUBLE_OFFSET)));
    case "boolean":
      // true is 3, false is 2: the low bit is the boolean.
      return ctx.fn.truncI64ToI1(raw);
    case "optional":
      return unboxOptional(raw, type.inner, ctx);
    case "value":
      return raw;
    default:
      return ice(`unboxValue: ${type.kind} has no machine representation`);
  }
}

// True when a Value is `undefined`.
// Whether a Value word holds a number (every double sits at or above the offset).
export function isNumberWord(raw: Value, ctx: Ctx): Value {
  return ctx.fn.icmp("uge", raw, imm(T.i64, DOUBLE_OFFSET));
}

export function isUndefinedValue(raw: Value, ctx: Ctx): Value {
  return ctx.fn.icmp("eq", raw, imm(T.i64, V_UNDEFINED));
}

// An optional (undefined/null marker, or a GC box holding the inner slot) to a Value.
function boxOptional(opt: Value, inner: ValueType, ctx: Ctx): Value {
  const result = ctx.fn.alloca(T.i64);
  const undefB = ctx.fn.newBlock("vbox.undef");
  const notUndefB = ctx.fn.newBlock("vbox.notundef");
  const nullB = ctx.fn.newBlock("vbox.null");
  const presentB = ctx.fn.newBlock("vbox.present");
  const endB = ctx.fn.newBlock("vbox.end");
  ctx.fn.brCond(
    ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker")),
    undefB,
    notUndefB,
  );
  ctx.fn.switchTo(undefB);
  ctx.fn.store(imm(T.i64, V_UNDEFINED), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker")), nullB, presentB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(imm(T.i64, V_NULL), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(presentB);
  const innerVal = unboxSlot(ctx.fn.load(T.i64, opt), inner, ctx);
  ctx.fn.store(boxValue(innerVal, inner, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.i64, result);
}

// A Value to an optional: undefined / null become the markers, anything else a fresh GC box
// holding the inner value's slot.
function unboxOptional(raw: Value, inner: ValueType, ctx: Ctx): Value {
  const result = ctx.fn.alloca(T.ptr);
  const undefB = ctx.fn.newBlock("vunbox.undef");
  const notUndefB = ctx.fn.newBlock("vunbox.notundef");
  const nullB = ctx.fn.newBlock("vunbox.null");
  const presentB = ctx.fn.newBlock("vunbox.present");
  const endB = ctx.fn.newBlock("vunbox.end");
  ctx.fn.brCond(ctx.fn.icmp("eq", raw, imm(T.i64, V_UNDEFINED)), undefB, notUndefB);
  ctx.fn.switchTo(undefB);
  ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(ctx.fn.icmp("eq", raw, imm(T.i64, V_NULL)), nullB, presentB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.externGlobal("cs_null_marker"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(presentB);
  const box = allocSlotBox(inner, ctx);
  ctx.fn.store(boxSlot(unboxValue(raw, inner, ctx), inner, ctx), box);
  ctx.fn.store(box, result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}
