// Object codegen: record allocation (literal, `new`) and field reads/writes. A record is
// `[shape pointer, field Values...]` for class instances and literals alike (codegen/shapes.ts);
// every field slot holds a Value (codegen/value.ts), boxed from the written value's own type and
// unboxed to the reading site's static type. Split out of expr.ts; the generic evaluators are
// imported back (circular, resolved at call time).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { FieldAccess, HExpr, HStmt } from "../hir/nodes.js";
import {
  type Ctx,
  boxSlot,
  evalValue,
  lookupVar,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
} from "./expr.js";
import {
  evalCoalesce,
  evalUnwrap,
  evalOptionalPtr,
  isNullishPtr,
  unboxOptionalValue,
} from "./optional.js";
import { allocRecord, loadShape, loadShapeWord, shapeRef, RECORD_HEADER_SLOTS } from "./shapes.js";
import { evalBoxed, unboxValue } from "./value.js";

// Evaluate an object-typed HExpr to a ptr (to the GC record).
export function evalObjectPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "objectLit": {
      // Field values are evaluated left to right BEFORE the record exists, matching JS (the
      // object is created after its property values).
      const vals = expr.fields.map((f) => evalBoxed(f, ctx));
      const rec = allocRecord(expr.shape, vals.length, ctx);
      vals.forEach((v, i) => ctx.fn.store(v, ctx.fn.gepSlot(rec, i + RECORD_HEADER_SLOTS)));
      return rec;
    }
    case "new": {
      // The record's shape (with the class's method table) is installed before the constructor
      // runs, so a method called from the constructor dispatches correctly.
      const fieldCount =
        ctx.shapes[expr.shape]?.fields.length ?? ice(`new: no shape ${expr.shape}`);
      const rec = allocRecord(expr.shape, fieldCount, ctx);
      const args = expr.args.map((a) => evalValue(a, ctx));
      // Constructors are static: run the nearest declared one (inherited if the class has none).
      if (expr.ctorClass !== null)
        ctx.fn.callVoid(`@${expr.ctorClass}.constructor`, [rec, ...args]);
      return rec;
    }
    case "objectSpread":
      return evalObjectSpread(expr, ctx);
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

// An inline-cache site's state: `[cached shape pointer, cached record slot]` (IcSite in
// runtime/shape.milo), zero until the first miss fills it.
function icSite(site: number, ctx: Ctx): Value {
  return ctx.mod.defineZeroWords(`ic.${site}`, 2);
}

// Branch on an IC hit: the record's shape is the cached one. `onHit` gets the cached record slot.
function withIc(
  obj: Value,
  site: Value,
  ctx: Ctx,
  onHit: (slot: Value) => void,
  onMiss: () => void,
): void {
  const hit = ctx.fn.icmp("eq", loadShape(obj, ctx), ctx.fn.load(T.ptr, ctx.fn.gepSlot(site, 0)));
  const hitB = ctx.fn.newBlock("ic.hit");
  const missB = ctx.fn.newBlock("ic.miss");
  const endB = ctx.fn.newBlock("ic.end");
  ctx.fn.brCond(hit, hitB, missB);
  ctx.fn.switchTo(hitB);
  onHit(ctx.fn.load(T.i64, ctx.fn.gepSlot(site, 1)));
  ctx.fn.br(endB);
  ctx.fn.switchTo(missB);
  onMiss();
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
}

// The raw Value of field `access` in record `obj`.
export function loadField(obj: Value, access: FieldAccess, ctx: Ctx): Value {
  switch (access.kind) {
    case "slot":
      return ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, access.index + RECORD_HEADER_SLOTS));
    case "ic": {
      const site = icSite(access.site, ctx);
      const out = ctx.fn.alloca(T.i64);
      withIc(
        obj,
        site,
        ctx,
        (slot) => ctx.fn.store(ctx.fn.load(T.i64, ctx.fn.gepSlotDyn(obj, slot)), out),
        () => {
          const name = ctx.mod.internedString(access.name);
          ctx.fn.store(ctx.fn.call("@cs_ic_get", T.i64, [obj, site, name]), out);
        },
      );
      return ctx.fn.load(T.i64, out);
    }
    default: {
      const never: never = access;
      return ice(`loadField: unhandled access ${(never as { kind: string }).kind}`);
    }
  }
}

function storeField(obj: Value, access: FieldAccess, v: Value, ctx: Ctx): void {
  switch (access.kind) {
    case "slot":
      ctx.fn.store(v, ctx.fn.gepSlot(obj, access.index + RECORD_HEADER_SLOTS));
      return;
    case "ic": {
      const site = icSite(access.site, ctx);
      withIc(
        obj,
        site,
        ctx,
        (slot) => ctx.fn.store(v, ctx.fn.gepSlotDyn(obj, slot)),
        () => {
          const name = ctx.mod.internedString(access.name);
          ctx.fn.callVoid("@cs_ic_set", [obj, site, name, v]);
        },
      );
      return;
    }
    default: {
      const never: never = access;
      ice(`storeField: unhandled access ${(never as { kind: string }).kind}`);
    }
  }
}

// Read `obj.field`: load the field's Value and unbox it to the site's static type.
export function evalMemberGet(expr: Extract<HExpr, { kind: "memberGet" }>, ctx: Ctx): Value {
  const obj = evalObjectPtr(expr.object, ctx);
  return unboxValue(loadField(obj, expr.access, ctx), expr.type, ctx);
}

// `obj?.field` → an optional: the undefined marker when `obj` is nullish, else the field.
export function evalOptionalMember(
  expr: Extract<HExpr, { kind: "optionalMember" }>,
  ctx: Ctx,
): Value {
  const objType = expr.object.type;
  if (objType.kind !== "optional") return ice("optionalMember on a non-optional receiver");
  const opt = evalOptionalPtr(expr.object, ctx);
  const result = ctx.fn.alloca(T.ptr);
  const absentB = ctx.fn.newBlock("optm.absent");
  const presentB = ctx.fn.newBlock("optm.present");
  const endB = ctx.fn.newBlock("optm.end");
  ctx.fn.brCond(isNullishPtr(opt, ctx), absentB, presentB);
  ctx.fn.switchTo(absentB);
  ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(presentB);
  const obj = unboxOptionalValue(opt, objType.inner, ctx);
  ctx.fn.store(unboxValue(loadField(obj, expr.access, ctx), expr.type, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// `obj.field = value`. The object is evaluated before the value, as in JS.
export function emitMemberSet(stmt: Extract<HStmt, { kind: "memberSet" }>, ctx: Ctx): void {
  const obj = evalObjectPtr(stmt.object, ctx);
  const v = evalBoxed(stmt.value, ctx);
  storeField(obj, stmt.access, v, ctx);
}

// A spread literal: evaluate the items in order (a spread source is copied if a later item could
// change it), then build the result layout that matches the sources' runtime shapes.
function evalObjectSpread(expr: Extract<HExpr, { kind: "objectSpread" }>, ctx: Ctx): Value {
  const temps = expr.items.map((it) => {
    if (it.kind === "prop") {
      const slot = ctx.fn.alloca(T.i64);
      ctx.fn.store(evalBoxed(it.value, ctx), slot);
      return slot;
    }
    let src = evalObjectPtr(it.value, ctx);
    if (it.snapshot) src = ctx.fn.call("@cs_obj_clone", T.ptr, [src]);
    const slot = ctx.fn.alloca(T.ptr);
    ctx.fn.store(src, slot);
    return slot;
  });
  const spreadTemps = expr.items.flatMap((it, i) => (it.kind === "spread" ? [temps[i]!] : []));
  const result = ctx.fn.alloca(T.ptr);
  const endB = ctx.fn.newBlock("spread.end");
  for (const c of expr.cases) {
    let match: Value | null = null;
    c.sources.forEach((shapeId, j) => {
      const shape = loadShape(ctx.fn.load(T.ptr, spreadTemps[j]!), ctx);
      const eq = ctx.fn.icmp("eq", shape, shapeRef(ctx, shapeId));
      match = match === null ? eq : ctx.fn.logicalAnd(match, eq);
    });
    const caseB = ctx.fn.newBlock("spread.case");
    const nextB = ctx.fn.newBlock("spread.next");
    ctx.fn.brCond(match ?? ice("spread case with no sources"), caseB, nextB);
    ctx.fn.switchTo(caseB);
    const rec = allocRecord(c.shape, c.fields.length, ctx);
    c.fields.forEach((f, k) => {
      const tmp = temps[f.item]!;
      const v =
        f.index === null
          ? ctx.fn.load(T.i64, tmp)
          : ctx.fn.load(
              T.i64,
              ctx.fn.gepSlot(ctx.fn.load(T.ptr, tmp), f.index + RECORD_HEADER_SLOTS),
            );
      ctx.fn.store(v, ctx.fn.gepSlot(rec, k + RECORD_HEADER_SLOTS));
    });
    ctx.fn.store(rec, result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(nextB);
  }
  ctx.fn.callVoid("@cs_shape_mismatch", []);
  ctx.fn.unreachable();
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// `Object.values(o)`: walk o's runtime shape, unboxing each field to the element type.
export function evalObjectValues(expr: Extract<HExpr, { kind: "objectValues" }>, ctx: Ctx): Value {
  const obj = evalObjectPtr(expr.object, ctx);
  const count = loadShapeWord(loadShape(obj, ctx), "fieldCount", ctx);
  const arr = ctx.fn.call("@cs_array_new", T.ptr, []);
  const iPtr = ctx.fn.alloca(T.i64);
  ctx.fn.store(imm(T.i64, 0), iPtr);
  const headB = ctx.fn.newBlock("ovals.head");
  const bodyB = ctx.fn.newBlock("ovals.body");
  const endB = ctx.fn.newBlock("ovals.end");
  ctx.fn.br(headB);
  ctx.fn.switchTo(headB);
  ctx.fn.brCond(ctx.fn.icmp("slt", ctx.fn.load(T.i64, iPtr), count), bodyB, endB);
  ctx.fn.switchTo(bodyB);
  const slot = ctx.fn.ladd(ctx.fn.load(T.i64, iPtr), imm(T.i64, RECORD_HEADER_SLOTS));
  const v = unboxValue(ctx.fn.load(T.i64, ctx.fn.gepSlotDyn(obj, slot)), expr.elementType, ctx);
  ctx.fn.call("@cs_array_push", T.i32, [arr, boxSlot(v, expr.elementType, ctx)]);
  ctx.fn.store(ctx.fn.ladd(ctx.fn.load(T.i64, iPtr), imm(T.i64, 1)), iPtr);
  ctx.fn.br(headB);
  ctx.fn.switchTo(endB);
  return arr;
}
