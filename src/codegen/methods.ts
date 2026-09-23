// Method calls on objects (`receiver.m(args)`). The function comes from the receiver's shape:
// a method-table slot for a class hierarchy the compiler proved exclusive, otherwise a by-name
// inline cache that finds either a class method (called with the object as `this`) or a field
// holding a closure (called with its env). Both callees take a pointer first (`this` or env), so
// one indirect call serves both.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr, MethodDispatch } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type Ctx, evalValue, irTypeOf } from "./expr.js";
import { evalObjectPtr } from "./objects.js";
import { loadShape, loadShapeWord } from "./shapes.js";

export function evalVirtualCall(expr: Extract<HExpr, { kind: "virtualCall" }>, ctx: Ctx): Value {
  const { arg0, fnptr } = loadMethodTarget(expr.receiver, expr.dispatch, ctx);
  const args = [arg0, ...expr.args.map((a) => evalValue(a, ctx))];
  return ctx.fn.callIndirect(fnptr, irTypeOf(expr.type), args);
}

// Statement-position method call (void methods, or a discarded value). `returnType` null → void.
export function evalVirtualCallStmt(
  receiver: HExpr,
  dispatch: MethodDispatch,
  args: HExpr[],
  returnType: ValueType | null,
  ctx: Ctx,
): void {
  const { arg0, fnptr } = loadMethodTarget(receiver, dispatch, ctx);
  const argVals = [arg0, ...args.map((a) => evalValue(a, ctx))];
  if (returnType === null) ctx.fn.callIndirectVoid(fnptr, argVals);
  else ctx.fn.callIndirect(fnptr, irTypeOf(returnType), argVals);
}

// The function to call and its first argument.
function loadMethodTarget(
  receiver: HExpr,
  dispatch: MethodDispatch,
  ctx: Ctx,
): { arg0: Value; fnptr: Value } {
  const obj = evalObjectPtr(receiver, ctx);
  const shape = loadShape(obj, ctx);
  switch (dispatch.kind) {
    case "vtable": {
      const table = loadShapeWord(shape, "methods", ctx);
      return { arg0: obj, fnptr: ctx.fn.load(T.ptr, ctx.fn.gepPtr(table, dispatch.index)) };
    }
    case "byName":
      return byName(obj, shape, dispatch, ctx);
    default: {
      const never: never = dispatch;
      return ice(`loadMethodTarget: unhandled dispatch ${(never as { kind: string }).kind}`);
    }
  }
}

// The site's cache is `[shape, kind, index]` (MethodSite in runtime/shape.milo): on a shape miss
// the runtime fills it, then both paths read the (now valid) entry.
function byName(
  obj: Value,
  shape: Value,
  dispatch: Extract<MethodDispatch, { kind: "byName" }>,
  ctx: Ctx,
): { arg0: Value; fnptr: Value } {
  const site = ctx.mod.defineZeroWords(`mic.${dispatch.site}`, 3);
  const missB = ctx.fn.newBlock("mic.miss");
  const readyB = ctx.fn.newBlock("mic.ready");
  const cached = ctx.fn.load(T.ptr, ctx.fn.gepSlot(site, 0));
  ctx.fn.brCond(ctx.fn.icmp("eq", shape, cached), readyB, missB);
  ctx.fn.switchTo(missB);
  ctx.fn.callVoid("@cs_ic_method", [obj, site, ctx.mod.internedString(dispatch.name)]);
  ctx.fn.br(readyB);

  ctx.fn.switchTo(readyB);
  const kind = ctx.fn.load(T.i64, ctx.fn.gepSlot(site, 1));
  const index = ctx.fn.load(T.i64, ctx.fn.gepSlot(site, 2));
  const fnSlot = ctx.fn.alloca(T.ptr);
  const argSlot = ctx.fn.alloca(T.ptr);
  const methodB = ctx.fn.newBlock("mic.method");
  const fieldB = ctx.fn.newBlock("mic.field");
  const callB = ctx.fn.newBlock("mic.call");
  ctx.fn.brCond(ctx.fn.icmp("eq", kind, imm(T.i64, 0)), methodB, fieldB);

  ctx.fn.switchTo(methodB);
  const table = loadShapeWord(shape, "methods", ctx);
  ctx.fn.store(ctx.fn.load(T.ptr, ctx.fn.gepPtrDyn(table, index)), fnSlot);
  ctx.fn.store(obj, argSlot);
  ctx.fn.br(callB);

  // A function-valued field: the slot holds a closure Value (tagged pointer to {fnptr, env, ...}).
  ctx.fn.switchTo(fieldB);
  const raw = ctx.fn.load(T.i64, ctx.fn.gepSlotDyn(obj, index));
  const closure = ctx.fn.i64ToPtr(ctx.fn.land(raw, imm(T.i64, -8)));
  ctx.fn.store(ctx.fn.load(T.ptr, ctx.fn.gepSlot(closure, 0)), fnSlot);
  ctx.fn.store(ctx.fn.load(T.ptr, ctx.fn.gepSlot(closure, 1)), argSlot);
  ctx.fn.br(callB);

  ctx.fn.switchTo(callB);
  return { arg0: ctx.fn.load(T.ptr, argSlot), fnptr: ctx.fn.load(T.ptr, fnSlot) };
}
