// `new Promise<T>((resolve, reject) => ...)`: a pending runtime Promise, plus two closures over it
// handed to the executor, which runs synchronously. `resolve(v)` settles it with v boxed to a slot
// (what `await` unboxes); `reject(e)` rejects it with the Error; a throw out of the executor rejects
// it too, as in JS. Calls after the first settlement are ignored by the runtime.

import { imm, type Value } from "../ir/builder.js";
import type { ModuleBuilder } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { ice } from "../diagnostics.js";
import { type Ctx, boxSlot, evalValue, irTypeOf } from "./expr.js";
import { allocClosureRecord } from "./alloc.js";

const defined = new WeakMap<ModuleBuilder, Set<string>>();

export function evalPromiseNew(expr: Extract<HExpr, { kind: "promiseNew" }>, ctx: Ctx): Value {
  const inner =
    expr.type.kind === "promise" ? expr.type.inner : ice("promiseNew not promise-typed");
  const executor = evalValue(expr.executor, ctx);
  const p = ctx.fn.call("@cs_promise_new", T.ptr, []);
  const resolve = closureOver(resolverFor(expr.resolveArity === 0 ? null : inner, ctx), p, ctx);
  const reject = closureOver(rejecter(ctx), p, ctx);

  // Run the executor under a handler: a synchronous throw rejects the promise instead of escaping.
  const saved = ctx.fn.call("@cs_handler_count", T.i32, []);
  const handler = ctx.fn.call("@cs_handler_alloc", T.ptr, []);
  ctx.fn.callVoid("@cs_push_handler", [handler]);
  const jumped = ctx.fn.call("@_setjmp", T.i32, [handler]);
  const runB = ctx.fn.newBlock("pnew.run");
  const threwB = ctx.fn.newBlock("pnew.threw");
  const endB = ctx.fn.newBlock("pnew.end");
  ctx.fn.brCond(ctx.fn.icmp("eq", jumped, imm(T.i32, 0)), runB, threwB);

  ctx.fn.switchTo(runB);
  const fnptr = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(executor, 0)));
  const env = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(executor, 1)));
  const args = [env, resolve, reject].slice(0, 1 + expr.executorArity);
  ctx.fn.callIndirectVoid(fnptr, args);
  ctx.fn.callVoid("@cs_handler_restore", [saved]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(threwB);
  ctx.fn.callVoid("@cs_handler_restore", [saved]);
  ctx.fn.callVoid("@cs_promise_reject", [p, ctx.fn.call("@cs_handler_thrown", T.ptr, [handler])]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return p;
}

function closureOver(fnName: string, env: Value, ctx: Ctx): Value {
  const rec = allocClosureRecord(ctx);
  ctx.fn.store(ctx.fn.ptrToI64(ctx.fn.funcRef(fnName)), ctx.fn.gepSlot(rec, 0));
  ctx.fn.store(ctx.fn.ptrToI64(env), ctx.fn.gepSlot(rec, 1));
  ctx.fn.store(ctx.mod.internedString(""), ctx.fn.gepSlot(rec, 2));
  return rec;
}

// The body of `resolve` for a value of type `inner` (null: a `() => void` resolve, for
// Promise<void>, which settles with undefined). One function per machine representation.
function resolverFor(inner: ValueType | null, ctx: Ctx): string {
  const param = inner === null || inner.kind === "undefined" ? null : irTypeOf(inner);
  const name = `cs.promise.resolve.${param === null ? "none" : slotKey(inner!)}`;
  if (!once(name, ctx)) return name;
  const env: Value = { name: "%env", type: T.ptr };
  const v: Value | null = param === null ? null : { name: "%v", type: param };
  const fn = ctx.mod.defineFunc(name, T.void, v === null ? [env] : [env, v]);
  const fctx = helperCtx(fn, ctx);
  const boxed = v === null ? imm(T.i64, 0) : boxSlot(v, inner!, fctx);
  fn.callVoid("@cs_promise_resolve", [env, boxed]);
  fn.retVoid();
  return name;
}

function rejecter(ctx: Ctx): string {
  const name = "cs.promise.reject";
  if (!once(name, ctx)) return name;
  const env: Value = { name: "%env", type: T.ptr };
  const reason: Value = { name: "%reason", type: T.ptr };
  const fn = ctx.mod.defineFunc(name, T.void, [env, reason]);
  fn.callVoid("@cs_promise_reject", [env, reason]);
  fn.retVoid();
  return name;
}

// boxSlot's cases, by the machine form of the value it boxes.
function slotKey(t: ValueType): string {
  switch (t.kind) {
    case "number":
      return "f64";
    case "boolean":
      return "i1";
    case "value":
      return "word";
    default:
      return "ptr";
  }
}

function once(name: string, ctx: Ctx): boolean {
  const set = defined.get(ctx.mod) ?? new Set<string>();
  defined.set(ctx.mod, set);
  if (set.has(name)) return false;
  set.add(name);
  return true;
}

function helperCtx(fn: Ctx["fn"], ctx: Ctx): Ctx {
  return {
    ...ctx,
    fn,
    vars: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
    fnReturnType: null,
    asyncFn: false,
  };
}
