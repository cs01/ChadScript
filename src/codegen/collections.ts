// Map/Set codegen: HExpr → IR Value for the runtime CsMap/CsSet operations. Keys/values cross the
// runtime boundary as boxed i64 slots (see boxSlot); `keyKind` selects the runtime's key equality.
// Split out of expr.ts; the receiver-dispatch and the generic evaluators it recurses into are
// imported back (circular, resolved at call time).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import {
  type Ctx,
  boxSlot,
  evalValue,
  lookupVar,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
  evalArrayPtr,
} from "./expr.js";
import { evalMemberGet } from "./objects.js";
import { evalCoalesce } from "./optional.js";

// Evaluate a map-typed HExpr to a ptr (to the runtime CsMap). `mapNew` allocates; `mapSet`
// returns the same map (JS `.set` is chainable).
export function evalMapPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "mapNew":
      return ctx.fn.call("@cs_map_new", T.ptr, []);
    case "mapSet":
      return evalMapSet(expr, ctx);
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);
    case "conditional":
      return evalConditional(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    default:
      return ice(`evalMapPtr: unhandled map expression ${expr.kind}`);
  }
}

// A map `key`/`value` argument: box it into an i64 slot per its own type.
function mapKeySlot(
  expr: Extract<HExpr, { kind: "mapSet" | "mapGet" | "mapHas" | "mapDelete" }>,
  ctx: Ctx,
): Value {
  return boxSlot(evalValue(expr.key, ctx), expr.key.type, ctx);
}

export function evalMapSet(expr: Extract<HExpr, { kind: "mapSet" }>, ctx: Ctx): Value {
  const map = evalMapPtr(expr.map, ctx);
  const key = boxSlot(evalValue(expr.key, ctx), expr.key.type, ctx);
  const value = boxSlot(evalValue(expr.value, ctx), expr.value.type, ctx);
  ctx.fn.callVoid("@cs_map_set", [map, key, value, imm(T.i32, expr.keyKind)]);
  return map; // chainable
}

// `map.get(k)` → `value | undefined`: the runtime returns the optional pointer directly.
export function evalMapGet(expr: Extract<HExpr, { kind: "mapGet" }>, ctx: Ctx): Value {
  return ctx.fn.call("@cs_map_get", T.ptr, [
    evalMapPtr(expr.map, ctx),
    mapKeySlot(expr, ctx),
    imm(T.i32, expr.keyKind),
  ]);
}

// Evaluate a set-typed HExpr to a ptr (to the runtime CsSet). `setAdd` returns the same set.
export function evalSetPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "setNew":
      return ctx.fn.call("@cs_set_new", T.ptr, []);
    case "setFromArray":
      return ctx.fn.call("@cs_set_from_array", T.ptr, [
        evalArrayPtr(expr.array, ctx),
        imm(T.i32, expr.keyKind),
      ]);
    case "setAdd": {
      const set = evalSetPtr(expr.set, ctx);
      ctx.fn.callVoid("@cs_set_add", [
        set,
        boxSlot(evalValue(expr.value, ctx), expr.value.type, ctx),
        imm(T.i32, expr.keyKind),
      ]);
      return set; // chainable
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);
    case "conditional":
      return evalConditional(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    default:
      return ice(`evalSetPtr: unhandled set expression ${expr.kind}`);
  }
}

// Set membership predicate (`.has` / `.delete`) → i1 from the runtime's i32 result.
export function evalSetPredicate(
  fn: string,
  expr: Extract<HExpr, { kind: "setHas" | "setDelete" }>,
  ctx: Ctx,
): Value {
  return ctx.fn.icmp(
    "ne",
    ctx.fn.call(fn, T.i32, [
      evalSetPtr(expr.set, ctx),
      boxSlot(evalValue(expr.value, ctx), expr.value.type, ctx),
      imm(T.i32, expr.keyKind),
    ]),
    imm(T.i32, 0),
  );
}
