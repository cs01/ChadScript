// Values of type `unknown`: a caught value or a builtin Error, both a pointer to a runtime CsThrown
// (runtime/errors.milo).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import { type Ctx, evalCall, evalCallClosure, evalString, lookupVar } from "./expr.js";
import { evalVirtualCall } from "./methods.js";

export function evalThrownPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "newError": {
      // The runtime copies the message; an absent one is "" (Node's `new Error().message`).
      const msg = expr.message ? evalString(expr.message, ctx) : ctx.mod.cstring("");
      return ctx.fn.call("@cs_new_error_kind", T.ptr, [imm(T.i32, expr.errorKind), msg]);
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);
    case "virtualCall":
      return evalVirtualCall(expr, ctx);
    default:
      return ice(`evalThrownPtr: unhandled error expression ${expr.kind}`);
  }
}
