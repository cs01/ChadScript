// Codegen for async/await: an async call spawns a fiber, `await` suspends on its promise. The
// runtime machinery (fibers, the microtask loop, promise settlement, rejection-as-throw) lives in
// runtime/async.c; this file only emits the calls into it. See docs/async-codegen-design.md.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import { type Ctx, boxSlot, unboxSlot, evalValue } from "./expr.js";

// A call to an async function → spawn a fiber running its body. Arguments are boxed into a GC env
// struct (the same {slot}* shape as a closure env) that the fiber body unpacks; a 0-arg call passes
// a null env. Returns the fiber's result `Promise*` — it does NOT run the body to completion, only
// to its first suspend (matching JS: an async call runs synchronously up to the first await).
export function evalAsyncCall(expr: Extract<HExpr, { kind: "asyncCall" }>, ctx: Ctx): Value {
  const inner = expr.type.kind === "promise" ? expr.type.inner : ice("asyncCall not promise-typed");
  void inner;
  let env: Value;
  if (expr.args.length === 0) {
    env = ctx.fn.nullPtr();
  } else {
    env = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, expr.args.length * 8)]);
    expr.args.forEach((a, i) => {
      ctx.fn.store(boxSlot(evalValue(a, ctx), a.type, ctx), ctx.fn.gepSlot(env, i));
    });
  }
  return ctx.fn.call("@cs_fiber_spawn", T.ptr, [{ name: `@${expr.name}`, type: T.ptr }, env]);
}

export function evalAwait(expr: Extract<HExpr, { kind: "await" }>, ctx: Ctx): Value {
  const promise = evalValue(expr.value, ctx);
  const raw = ctx.fn.call("@cs_await", T.i64, [promise]);
  // `await` of a Promise<void> still suspends and re-throws a rejection, but yields no value — the
  // result is discarded (statement position), so skip the unbox (undefined has no slot form).
  if (expr.type.kind === "undefined") return imm(T.ptr, 0);
  return unboxSlot(raw, expr.type, ctx);
}
