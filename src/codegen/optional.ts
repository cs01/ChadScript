// Optional/nullable codegen: the {undefined|null sentinel, or a GC box} pointer representation of
// `T | undefined` / `T | null` values, plus `??`, narrowing unwrap, null checks, and `arr[i]`
// (which yields `element | undefined`). Split out of expr.ts; generic evaluators + the object/array/
// map helpers it recurses into are imported back (circular, resolved at call time).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  type Ctx,
  boxSlot,
  unboxSlot,
  irTypeOf,
  lookupVar,
  evalValue,
  evalString,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
  evalArrayPtr,
  emitStrictEq,
} from "./expr.js";
import { evalMemberGet } from "./objects.js";
import { evalNumber } from "./numbers.js";
import { evalArrayHof } from "./array.js";
import { evalMapGet } from "./collections.js";

// Evaluate an optional-typed HExpr to its pointer rep (undefined sentinel, or a box pointer).
export function evalOptionalPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "index") return evalIndex(expr, ctx);
  if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
  if (expr.kind === "arrayPop")
    return ctx.fn.call(`@${expr.fn}`, T.ptr, [evalArrayPtr(expr.array, ctx)]);
  if (expr.kind === "arrayAt")
    return ctx.fn.call("@cs_array_at", T.ptr, [
      evalArrayPtr(expr.array, ctx),
      evalNumber(expr.index, ctx),
    ]);
  if (expr.kind === "strAt")
    return ctx.fn.call("@cs_str_at", T.ptr, [
      evalString(expr.str, ctx),
      evalNumber(expr.index, ctx),
    ]);
  if (expr.kind === "memberGet") return evalMemberGet(expr, ctx); // an optional field
  if (expr.kind === "wrap") return evalWrap(expr, ctx);
  if (expr.kind === "undefinedOpt") return ctx.mod.externGlobal("cs_undefined_marker");
  if (expr.kind === "nullOpt") return ctx.mod.externGlobal("cs_null_marker");
  if (expr.kind === "call") return evalCall(expr, ctx);
  if (expr.kind === "callClosure") return evalCallClosure(expr, ctx);
  if (expr.kind === "virtualCall") return evalVirtualCall(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  if (expr.kind === "coalesce") return evalCoalesce(expr, ctx);
  if (expr.kind === "arrayHof") return evalArrayHof(expr, ctx); // .find() → element | undefined
  if (expr.kind === "mapGet") return evalMapGet(expr, ctx); // map.get() → value | undefined
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

// Unbox a raw i64 slot value to `type` (e.g. a capture loaded from a closure env).
export function unboxSlotValue(raw: Value, type: ValueType, ctx: Ctx): Value {
  return unboxSlot(raw, type, ctx);
}

// Unwrap a narrowed optional (proven present by an `x !== undefined` guard): load its box and
// unbox to the inner type.
export function evalUnwrap(expr: Extract<HExpr, { kind: "unwrap" }>, ctx: Ctx): Value {
  return unboxOptionalValue(evalOptionalPtr(expr.value, ctx), expr.type, ctx);
}

// True when an optional pointer is either nullish sentinel (undefined OR null). Used by `??`
// (both are nullish) and by console.log's optional branch.
export function isNullishPtr(opt: Value, ctx: Ctx): Value {
  const isUndef = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker"));
  return ctx.fn.logicalOr(isUndef, isNull);
}

// `x === null`/`x === undefined` (and `!==`) → i1. `sentinel` selects which marker to compare,
// so the null and undefined cases stay distinct for a `T | null | undefined` value.
export function evalNullCheck(expr: Extract<HExpr, { kind: "nullCheck" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.value, ctx);
  const marker = expr.sentinel === "null" ? "cs_null_marker" : "cs_undefined_marker";
  return ctx.fn.icmp(expr.isEqual ? "eq" : "ne", opt, ctx.mod.externGlobal(marker));
}

// `===`/`!==` between an optional (`T | undefined`) and a CONCRETE value of the inner type — e.g.
// `str.at(i) !== "h"`, `parts[0] === "apple"`. (Optional-vs-null/undefined lowers to a nullCheck
// instead.) JS: an absent optional never equals a concrete value, so `===` is false / `!==` true
// when absent; when present, unwrap and compare the inner values by their type.
export function evalOptionalEquality(
  optExpr: HExpr,
  otherExpr: HExpr,
  isNe: boolean,
  ctx: Ctx,
): Value {
  if (optExpr.type.kind !== "optional") return ice("evalOptionalEquality: not optional-typed");
  const innerType = optExpr.type.inner;
  const opt = evalOptionalPtr(optExpr, ctx);
  const other = evalValue(otherExpr, ctx); // evaluate once, before the branch (dominates both)
  const result = ctx.fn.alloca(T.i1);
  const absentB = ctx.fn.newBlock("opteq.absent");
  const presentB = ctx.fn.newBlock("opteq.present");
  const endB = ctx.fn.newBlock("opteq.end");

  ctx.fn.brCond(isNullishPtr(opt, ctx), absentB, presentB);

  ctx.fn.switchTo(absentB); // absent ≠ any concrete value
  ctx.fn.store(imm(T.i1, isNe ? 1 : 0), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(presentB);
  const inner = unboxSlot(ctx.fn.load(T.i64, opt), innerType, ctx);
  const eq = emitStrictEq(inner, other, innerType, ctx);
  ctx.fn.store(isNe ? ctx.fn.logicalNot(eq) : eq, result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.i1, result);
}

// `a ?? b`: if `a` is nullish (undefined OR null), use `b`; else unwrap the boxed inner value.
export function evalCoalesce(expr: Extract<HExpr, { kind: "coalesce" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.left, ctx);
  const isUndef = isNullishPtr(opt, ctx);
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
