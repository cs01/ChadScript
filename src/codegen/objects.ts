// Object codegen: object/class-instance record allocation, field layout, and `obj.field` reads.
// A class instance reserves record slot 0 for its vtable pointer (headerOffset); a plain object
// literal has no header. Split out of expr.ts; the generic evaluators are imported back (circular,
// resolved at call time).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  type Ctx,
  boxSlot,
  unboxSlot,
  evalValue,
  lookupVar,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
  evalCoalesce,
  evalUnwrap,
} from "./expr.js";

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
      // A class instance reserves record slot 0 for its vtable pointer, so allocate one extra
      // slot and store the class's vtable there before running the constructor (which sets fields
      // starting at slot 1 via memberSet).
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, (expr.fieldCount + 1) * 8)]);
      ctx.fn.store(ctx.fn.ptrToI64(ctx.mod.vtableAddr(expr.className)), ctx.fn.gepSlot(rec, 0));
      const args = expr.args.map((a) => evalValue(a, ctx));
      // Constructors are static: run the nearest declared one (inherited if the class has none).
      if (expr.ctorClass !== null)
        ctx.fn.callVoid(`@${expr.ctorClass}.constructor`, [rec, ...args]);
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
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);
    default:
      return ice(`evalObjectPtr: unhandled object expression ${expr.kind}`);
  }
}

// Record-slot offset added to a field index: a class instance reserves slot 0 for its vtable
// pointer, so its fields start at slot 1; a plain object literal has no header.
export function headerOffset(objectType: ValueType): number {
  return objectType.kind === "object" && objectType.className !== undefined ? 1 : 0;
}

// Read `obj.field`: load the field's i64 slot and unbox it to the field type.
export function evalMemberGet(expr: Extract<HExpr, { kind: "memberGet" }>, ctx: Ctx): Value {
  const obj = evalObjectPtr(expr.object, ctx);
  const raw = ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, expr.slot + headerOffset(expr.object.type)));
  return unboxSlot(raw, expr.type, ctx);
}
