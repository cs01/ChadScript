// How a member access site finds its field (HIR FieldAccess), from the layouts that can reach
// its receiver (lower/layouts.ts): one static slot when they all agree, an inline cache otherwise.

import type ts from "typescript";
import type { FieldAccess, MethodDispatch } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, vtableIndexOf } from "./lower.js";
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
