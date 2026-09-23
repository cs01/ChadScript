// How a member access site finds its field (HIR FieldAccess), from the layouts that can reach
// its receiver (lower/layouts.ts): one static slot when they all agree, an inline cache otherwise.

import type ts from "typescript";
import type { FieldAccess, HExpr, MethodDispatch } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, vtableIndexOf } from "./lower.js";
import { isNullishType, nullishLit } from "./value-lower.js";
import { ice } from "../diagnostics.js";
import { type Layout, agreedIndex } from "./layouts.js";

export function accessIn(layouts: readonly Layout[], name: string, ctx: LowerCtx): FieldAccess {
  const index = agreedIndex(layouts, name);
  if (index !== null) return { kind: "slot", index };
  return { kind: "ic", site: ctx.counter.n++, name };
}

// The access for `recv.name`.
export function fieldAccessAt(recv: ts.Expression, name: string, ctx: LowerCtx): FieldAccess {
  return accessIn(ctx.layouts.reaching(recv), name, ctx);
}

// How `recv.method(...)` finds its function. A method-table slot is only valid when every layout
// that can reach the receiver is the static class or a subclass (slots are shared down one
// hierarchy, not across unrelated classes or literals that merely look the same).
export function methodDispatchAt(
  recv: ts.Expression,
  recvType: ValueType,
  method: string,
  ctx: LowerCtx,
): MethodDispatch {
  const cls = recvType.kind === "object" ? recvType.className : undefined;
  if (cls !== undefined && ctx.classTables.get(cls)?.impls.has(method)) {
    const exclusive = ctx.layouts
      .reaching(recv)
      .every((l) => l.site.kind === "class" && ctx.classAncestors.get(l.site.classId)?.has(cls));
    if (exclusive) return { kind: "vtable", index: vtableIndexOf(cls, method, ctx) };
  }
  return { kind: "byName", site: ctx.counter.n++, name: method };
}

export // Read field `name` of the object `recv` (of type `objType`) at the site's type `type`. A field
// slot holds a self-describing Value, so a read unboxes straight to the type the site uses: an
// optional field narrowed by tsc (`if (n.next !== null) n.next.v`) reads as its inner type with no
// optional box in between.
function lowerFieldRead(
  recv: ts.Expression,
  name: string,
  objType: Extract<ValueType, { kind: "object" }>,
  type: ValueType,
  ctx: LowerCtx,
): HExpr {
  const slot = objType.shape.fields.findIndex((f) => f.name === name);
  if (slot < 0) ice(`lower: object has no field ${name}`);
  const fieldType = objType.shape.fields[slot]!.type;
  const narrowed =
    (fieldType.kind === "optional" && type.kind !== "optional") || fieldType.kind === "value";
  // tsc narrows only reference chains (no calls), so the read has no effect to keep.
  if (fieldType.kind === "value" && isNullishType(type)) return nullishLit(type);
  return {
    kind: "memberGet",
    object: lowerExpr(recv, ctx),
    access: fieldAccessAt(recv, name, ctx),
    type: narrowed && type.kind !== "undefined" && type.kind !== "null" ? type : fieldType,
  };
}
