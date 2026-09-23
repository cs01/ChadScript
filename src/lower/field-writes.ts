// Field-write widening: a shape's field types say how the printers (console.log, JSON.stringify)
// decode each slot, and a literal records the types of the values it was BUILT with. A later write
// through a wider static type (`const it: Item = { id: "b" }; it.id = 42;` with `id: number |
// string`, or `o.x = undefined` into a field built holding a number) stores a word of another
// kind, which the printers would decode with the wrong member. So every write is recorded against
// the layouts that can reach its receiver (the same flow-insensitive, conservative set member
// access uses), and each of their shapes' field types is widened to cover what was written.

import ts from "typescript";
import { VT, type ValueType } from "../hir/types.js";
import type { LowerCtx } from "./lower.js";

export interface FieldWrite {
  layouts: number[];
  name: string;
  type: ValueType;
}

export function recordFieldWrite(
  receiver: ts.Expression,
  name: string,
  written: ValueType,
  ctx: LowerCtx,
): void {
  ctx.fieldWrites.push({
    layouts: ctx.layouts.reaching(receiver).map((l) => l.id),
    name,
    type: written,
  });
}

// Apply every recorded write to the shapes of its layouts. Idempotent, so it runs both before
// spread results are built (they copy their sources' field types) and after (a write can target a
// spread result too).
export function applyFieldWrites(ctx: LowerCtx): void {
  for (const w of ctx.fieldWrites) {
    for (const layout of w.layouts) {
      for (const shapeId of ctx.layoutShapes.get(layout) ?? []) {
        const field = ctx.shapes.shapes[shapeId]?.fields.find((f) => f.name === w.name);
        if (field) field.type = widen(field.type, w.type);
      }
    }
  }
}

// The kinds a word of type `t` can be, each with its representation.
function parts(t: ValueType): ValueType[] {
  if (t.kind === "value") return t.members;
  if (t.kind === "optional") return [t.inner, VT.undefined, VT.null];
  return [t];
}

// The narrowest field type covering both `a` and `b`. Two parts of the same kind already agree in
// representation (a flow that nests differently is CS1240), so the first one stands for both.
function widen(a: ValueType, b: ValueType): ValueType {
  const all: ValueType[] = [];
  for (const p of [...parts(a), ...parts(b)]) {
    if (!all.some((q) => q.kind === p.kind)) all.push(p);
  }
  if (all.length === parts(a).length) return a; // nothing new: keep the type as it was
  const nullish = all.filter((p) => p.kind === "undefined" || p.kind === "null");
  const rest = all.filter((p) => p.kind !== "undefined" && p.kind !== "null");
  if (rest.length === 1 && nullish.length > 0) return { kind: "optional", inner: rest[0]! };
  if (rest.length === 1) return rest[0]!;
  return { kind: "value", members: all };
}
