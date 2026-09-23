// An array literal, built in the representation its slot chose (resolveType). A nested literal
// element is built in the slot's element representation, not its own inferred one: tsc's subtype
// reduction types `[[1, 2], [3, [4]]]` as `(number | number[])[][]`, so the inner `[1, 2]`, whose
// own type is `number[]`, is an element of a `(number | number[])[]` slot and must hold Value
// words; built from its own type it held raw doubles that every reader decoded as words.

import ts from "typescript";
import type { ArrayElement, HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { lowerArrayElement } from "./declarations.js";
import { slotIdentical } from "./generics.js";
import { type LowerCtx, unparen } from "./lower.js";
import { coerceElement } from "./value-lower.js";

export function lowerArrayLiteral(
  lit: ts.ArrayLiteralExpression,
  type: ValueType,
  ctx: LowerCtx,
): HExpr {
  const nested = type.kind === "array" ? literalSlot(type.element) : null;
  const elements = lit.elements.map((e): ArrayElement => {
    const inner = unparen(e);
    if (nested !== null && ts.isArrayLiteralExpression(inner)) {
      return coerceElement({ spread: false, value: lowerArrayLiteral(inner, nested, ctx) }, type);
    }
    const el = lowerArrayElement(e, ctx);
    // A spread source whose slots differ from this literal's is copied through a conversion (the
    // spread copies anyway, so nothing can notice).
    if (el.spread && type.kind === "array") {
      const src = el.value.type;
      if (src.kind === "array" && !slotIdentical(src.element, type.element)) {
        return { spread: true, value: { kind: "convertArray", value: el.value, type } };
      }
    }
    return coerceElement(el, type);
  });
  return { kind: "arrayLit", elements, type };
}

// The array type a nested literal element is built as: the element slot itself, or the one array
// member of a union or optional slot (a union holds at most one array type).
function literalSlot(element: ValueType): ValueType | null {
  switch (element.kind) {
    case "array":
      return element;
    case "value":
      return element.members.find((m) => m.kind === "array") ?? null;
    case "optional":
      return element.inner.kind === "array" ? element.inner : null;
    default:
      return null;
  }
}
