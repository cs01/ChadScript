// Object literal lowering. A literal allocates exactly the properties it writes, in JS order (the
// order Node prints them in and the order its layout records), NOT the fields of its contextual
// type: an omitted optional property does not exist on the object. Spread literals copy whatever
// fields the source's runtime shape has, so their result layouts come from the whole-program
// layout analysis and are attached once every other allocation has a shape (resolveSpreads).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr, SpreadCase, SpreadItem } from "../hir/nodes.js";
import type { ObjectField, ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, nameForSymbol, resolveType } from "./lower.js";
import { VT } from "../hir/types.js";
import { valueTypeOf } from "./type-translation.js";
import { literalItems } from "./layouts.js";

export function lowerObjectLit(
  ole: ts.ObjectLiteralExpression,
  ctx: LowerCtx,
  type: ValueType,
): HExpr {
  if (type.kind !== "object") ice("lower: object literal without a resolved object shape");
  const items = literalItems(ole);
  if (!items.some((i) => i.kind === "spread")) {
    // tsc rejects duplicate property names in a literal, so each name has exactly one value.
    const fields = ole.properties.map((p) => lowerProperty(p, ctx));
    const shape = ctx.shapes.literal(fields.map((f) => ({ name: f.name, type: f.value.type })));
    const layoutId = ctx.layouts.literalLayout(ole).id;
    ctx.layoutShapes.set(layoutId, (ctx.layoutShapes.get(layoutId) ?? new Set()).add(shape));
    return { kind: "objectLit", shape, fields: fields.map((f) => f.value), type };
  }
  const hItems: SpreadItem[] = ole.properties.map((p): SpreadItem => {
    if (ts.isSpreadAssignment(p)) {
      const value = lowerExpr(p.expression, ctx);
      if (value.type.kind !== "object")
        ice(`lower: spread of ${value.type.kind} in object literal`);
      return { kind: "spread", value, snapshot: false };
    }
    return { kind: "prop", value: lowerProperty(p, ctx).value };
  });
  // A spread's fields are read when the literal is built, after every item has been evaluated; if
  // a later initializer could run code (a call), the source is copied at its own position instead.
  hItems.forEach((it, i) => {
    if (it.kind === "spread") {
      it.snapshot = hItems.slice(i + 1).some((later) => !isPure(later.value));
    }
  });
  const node: Extract<HExpr, { kind: "objectSpread" }> = {
    kind: "objectSpread",
    items: hItems,
    cases: [],
    type,
  };
  const pending = ctx.pendingSpreads.get(ole) ?? [];
  pending.push(node);
  ctx.pendingSpreads.set(ole, pending);
  return node;
}

function lowerProperty(
  p: ts.ObjectLiteralElementLike,
  ctx: LowerCtx,
): { name: string; value: HExpr } {
  if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
    return { name: p.name.text, value: lowerExpr(p.initializer, ctx) };
  }
  if (ts.isShorthandPropertyAssignment(p)) {
    // `{ a }` = field `a` from the variable `a`. Resolve the VALUE symbol (the variable).
    const valueSym = ctx.checker.getShorthandAssignmentValueSymbol(p);
    if (!valueSym) return ice(`lower: cannot resolve shorthand property ${p.name.text}`);
    return {
      name: p.name.text,
      value: {
        kind: "varRef",
        name: nameForSymbol(valueSym, p.name.text, ctx),
        type: valueTypeOf(p.name, ctx),
      },
    };
  }
  return ice(`lower: unsupported object member ${ts.SyntaxKind[p.kind]}`);
}

// An expression whose evaluation cannot write to any object.
function isPure(e: HExpr): boolean {
  switch (e.kind) {
    case "numberLit":
    case "stringLit":
    case "boolLit":
    case "nullLit":
    case "undefinedLit":
    case "varRef":
    case "closure":
      return true;
    case "memberGet":
      return isPure(e.object);
    default:
      return false;
  }
}

// Attach every spread literal's cases. A layout can have several shapes (same field names, different
// field representations), and a spread result's shapes depend on its sources' shapes, which may
// include spread results (even its own), so this iterates until no new shape appears. Shapes are
// deduplicated by content, so the iteration is finite.
export function resolveSpreads(ctx: LowerCtx): void {
  for (let round = 0; ; round++) {
    if (round > 64) ice("lower: spread shapes did not converge");
    let changed = false;
    for (const layout of ctx.layouts.layouts) {
      if (layout.site.kind !== "spread") continue;
      const node = layout.site.node;
      const hNodes = ctx.pendingSpreads.get(node) ?? ice("lower: spread literal not lowered");
      for (const combo of layout.site.combos) {
        const shapeSets = combo.map((id) => [...(ctx.layoutShapes.get(id) ?? [])]);
        for (const sources of product(shapeSets)) {
          for (const h of hNodes) {
            if (h.cases.some((c) => c.sources.every((s, j) => s === sources[j]))) continue;
            const c = spreadCase(h, node, layout.names, sources, ctx);
            h.cases.push(c);
            const set = ctx.layoutShapes.get(layout.id) ?? new Set<number>();
            ctx.layoutShapes.set(layout.id, set.add(c.shape));
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
  }
}

// The result of one spread literal for one combination of source shapes. The last item that
// writes a name supplies its value; the name's position is where it was first written.
function spreadCase(
  h: Extract<HExpr, { kind: "objectSpread" }>,
  node: ts.ObjectLiteralExpression,
  names: readonly string[],
  sources: number[],
  ctx: LowerCtx,
): SpreadCase {
  const spreadAt = h.items.flatMap((it, i) => (it.kind === "spread" ? [i] : []));
  type FieldSrc = { item: number; index: number | null; field: ObjectField };
  const fields: FieldSrc[] = [];
  for (const name of names) {
    let src: FieldSrc | null = null;
    for (let i = 0; i < h.items.length; i++) {
      const it = h.items[i]!;
      if (it.kind === "prop") {
        if (propName(node, i) === name) {
          src = { item: i, index: null, field: { name, type: it.value.type } };
        }
        continue;
      }
      const shape = ctx.shapes.shapes[sources[spreadAt.indexOf(i)]!]!;
      const idx = shape.fields.findIndex((f) => f.name === name);
      if (idx >= 0) src = { item: i, index: idx, field: shape.fields[idx]! };
    }
    fields.push(src ?? ice(`lower: spread result field ${name} has no source`));
  }
  return {
    sources,
    shape: ctx.shapes.literal(fields.map((f) => f.field)),
    fields: fields.map((f) => ({ item: f.item, index: f.index })),
  };
}

function product<T>(sets: readonly (readonly T[])[]): T[][] {
  let acc: T[][] = [[]];
  for (const s of sets) acc = acc.flatMap((prefix) => s.map((x) => [...prefix, x]));
  return acc;
}

function propName(node: ts.ObjectLiteralExpression, i: number): string {
  const p = node.properties[i];
  if (
    p &&
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
    ts.isIdentifier(p.name)
  ) {
    return p.name.text;
  }
  return ice("lower: spread literal prop without a name");
}
// `Object.keys(o)` / `Object.values(o)` over a closed object shape. keys → the field names as a
// string[] (statically known); values → the field values as an array (only when the fields share
// one representation, since a homogeneous array can't hold a mixed union). entries needs tuples.
export function lowerObjectNamespace(method: string, argExpr: ts.Expression, ctx: LowerCtx): HExpr {
  const objType = resolveType(argExpr, ctx);
  if (objType.kind !== "object") ice(`lower: Object.${method} on non-object ${objType.kind}`);
  // Both read the RUNTIME shape: a value typed through an interface may carry more fields, in
  // another order, than its static type lists, and Node reports the object's own.
  const obj = lowerExpr(argExpr, ctx);
  if (method === "keys") {
    return { kind: "runtimeCall", fn: "cs_obj_keys", args: [obj], type: VT.array(VT.string) };
  }
  if (method === "values") {
    // validate/layout-rules.ts rejects a receiver whose reaching layouts mix representations.
    const elementType = objType.shape.fields[0]?.type ?? VT.number;
    return { kind: "objectValues", object: obj, elementType, type: VT.array(elementType) };
  }
  return ice(`lower: Object.${method} not supported yet`);
}
