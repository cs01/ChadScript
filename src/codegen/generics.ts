// The container conversions at an erased-generic boundary (HIR convertArray / adaptClosure; see
// lower/generics.ts for where they are emitted and why each is unobservable there).

import { ice } from "../diagnostics.js";
import { imm, type ModuleBuilder, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  boxSlot,
  evalArrayPtr,
  evalFunctionPtr,
  irTypeOf,
  arrayElementAt,
  type Ctx,
} from "./expr.js";
import { boxValue, unboxValue } from "./value.js";
import { allocClosureRecord, allocSlots } from "./alloc.js";

// A machine value of `from` in the representation of `to`. Exactly one side is a Value word (or
// both are the same representation): the boundary only ever converts between T's word and the
// instantiation's own machine value. Two containers of one kind are the same representation by
// the time an adapter exists (lower/generics.ts elementPlan, lower/callback-adapt.ts paramPlan).
function convertMachine(v: Value, from: ValueType, to: ValueType, ctx: Ctx): Value {
  if (from.kind === "value" && to.kind === "value") return v;
  if (to.kind === "value") return boxValue(v, from, ctx);
  if (from.kind === "value") return unboxValue(v, to, ctx);
  if (from.kind === to.kind) return v;
  return ice(`codegen: no generic conversion from ${from.kind} to ${to.kind}`);
}

export function evalConvertArray(expr: Extract<HExpr, { kind: "convertArray" }>, ctx: Ctx): Value {
  const fromT = expr.value.type;
  const toT = expr.type;
  if (fromT.kind !== "array" || toT.kind !== "array") return ice("codegen: convertArray types");
  const src = ctx.fn.alloca(T.ptr);
  ctx.fn.store(evalArrayPtr(expr.value, ctx), src);
  const out = ctx.fn.call("@cs_array_new", T.ptr, []);
  const idx = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, 0), idx);
  const headB = ctx.fn.newBlock("conv.head");
  const bodyB = ctx.fn.newBlock("conv.body");
  const endB = ctx.fn.newBlock("conv.end");
  ctx.fn.br(headB);
  ctx.fn.switchTo(headB);
  const i = ctx.fn.load(T.i32, idx);
  const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, src)]);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), bodyB, endB);
  ctx.fn.switchTo(bodyB);
  const elem = arrayElementAt(ctx.fn.load(T.ptr, src), i, fromT.element, ctx);
  const converted = convertMachine(elem, fromT.element, toT.element, ctx);
  ctx.fn.call("@cs_array_push", T.i32, [out, boxSlot(converted, toT.element, ctx)]);
  ctx.fn.store(ctx.fn.iadd(i, imm(T.i32, 1)), idx);
  ctx.fn.br(headB);
  ctx.fn.switchTo(endB);
  return out;
}

// Adapter functions are named per module; one per adaptClosure site.
const adapterCount = new WeakMap<ModuleBuilder, number>();

// A closure of type `expr.type` whose env holds the original closure record. The adapter function
// takes the outer parameters, converts the ones the original declares (a callback may declare
// fewer than it is called with, as in JS), calls the original through its record, and converts
// the result back.
export function evalAdaptClosure(expr: Extract<HExpr, { kind: "adaptClosure" }>, ctx: Ctx): Value {
  const inner = expr.value.type;
  const outer = expr.type;
  if (inner.kind !== "function" || outer.kind !== "function") {
    return ice("codegen: adaptClosure types");
  }
  const orig = evalFunctionPtr(expr.value, ctx);
  const n = adapterCount.get(ctx.mod) ?? 0;
  adapterCount.set(ctx.mod, n + 1);
  const name = `adapt.${n}`;

  const params: Value[] = [
    { name: "%arg0", type: T.ptr },
    ...outer.params.map((p, i) => ({ name: `%arg${i + 1}`, type: irTypeOf(p) })),
  ];
  const fn = ctx.mod.defineFunc(name, outer.ret ? irTypeOf(outer.ret) : T.void, params);
  const actx: Ctx = {
    ...ctx,
    fn,
    vars: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
  };
  const rec = fn.i64ToPtr(fn.load(T.i64, fn.gepSlot(params[0]!, 0)));
  const fnptr = fn.i64ToPtr(fn.load(T.i64, fn.gepSlot(rec, 0)));
  const env = fn.i64ToPtr(fn.load(T.i64, fn.gepSlot(rec, 1)));
  const args = inner.params.map((p, i) =>
    convertMachine(params[i + 1]!, outer.params[i]!, p, actx),
  );
  if (inner.ret === null || outer.ret === null) {
    fn.callIndirectVoid(fnptr, [env, ...args]);
    fn.retVoid();
  } else {
    const r = fn.callIndirect(fnptr, irTypeOf(inner.ret), [env, ...args]);
    fn.ret(convertMachine(r, inner.ret, outer.ret, actx));
  }

  const envRec = allocSlots([true], ctx);
  ctx.fn.store(ctx.fn.ptrToI64(orig), ctx.fn.gepSlot(envRec, 0));
  const out = allocClosureRecord(ctx);
  ctx.fn.store(ctx.fn.ptrToI64(ctx.fn.funcRef(name)), ctx.fn.gepSlot(out, 0));
  ctx.fn.store(ctx.fn.ptrToI64(envRec), ctx.fn.gepSlot(out, 1));
  // Word 2 is the display text util.inspect prints: the adapted function keeps the original's.
  ctx.fn.store(ctx.fn.load(T.ptr, ctx.fn.gepSlot(orig, 2)), ctx.fn.gepSlot(out, 2));
  return out;
}
