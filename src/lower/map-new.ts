// `new Map<K, V>()` and `new Map<K, V>([[k1, v1], [k2, v2]])`. The entries form is admitted only as
// an array literal of two-element array literals (validate/collection-rules.ts): each pair is a
// tuple `[K, V]` whose element types differ, which has no array representation here, so the pairs
// are never built. The literal lowers to a chain of `set`s instead, which inserts in the same order
// and lets a later duplicate key win, as the Map constructor does.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, coerceToTarget } from "./lower.js";
import { keyKindOf } from "./declarations.js";

export function lowerMapNew(ne: ts.NewExpression, type: ValueType, ctx: LowerCtx): HExpr {
  if (type.kind !== "map") return ice("lower: lowerMapNew on a non-Map type");
  const entries = ne.arguments?.[0];
  let map: HExpr = { kind: "mapNew", type };
  if (!entries) return map;
  if (!ts.isArrayLiteralExpression(entries)) {
    return ice("lower: `new Map(entries)` needs an array literal of [key, value] pairs");
  }
  for (const pair of entries.elements) {
    if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) {
      return ice("lower: a `new Map` entry is not a [key, value] literal");
    }
    map = {
      kind: "mapSet",
      map,
      key: lowerExpr(pair.elements[0]!, ctx),
      value: coerceToTarget(lowerExpr(pair.elements[1]!, ctx), type.value),
      keyKind: keyKindOf(type.key),
      type,
    };
  }
  return map;
}
