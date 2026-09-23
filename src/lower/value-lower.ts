// Lowering support for Value unions (ValueType `value`): the explicit box/unbox conversions at
// every place a value flows into a slot, and the `typeof x === "..."` tag test. Split out of
// lower.ts; lowerExpr is imported back (circular, resolved at call time).

import ts from "typescript";
import type { ArrayElement, HExpr, TypeTest } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr } from "./lower.js";

// Coerce a lowered value into the representation of the slot it lands in. A Value-union slot boxes
// a concrete value; a concrete slot fed from a Value unboxes it. For an optional slot a bare
// `null`/`undefined` becomes the matching sentinel, an already-optional value passes through and
// any other value is wrapped. Other targets are a no-op. This is applied EXPLICITLY at the boundaries that feed a
// real optional slot (return / optional var decl / assignment / user-function argument) — never
// blanket-applied, because many builtin params are `T | undefined` yet take raw values.
export function coerceToTarget(h: HExpr, target: ValueType): HExpr {
  // A Value-union slot takes any member boxed to a word; a concrete slot fed from a Value (tsc proved
  // the word holds that type) unboxes it.
  if (target.kind === "value") {
    return h.type.kind === "value" ? h : { kind: "box", value: h, type: target };
  }
  if (h.type.kind === "value") return { kind: "unbox", value: h, type: target };
  if (target.kind !== "optional" || h.type.kind === "optional") return h;
  if (h.type.kind === "null") return { kind: "nullOpt", type: target };
  if (h.type.kind === "undefined") return { kind: "undefinedOpt", type: target };
  return { kind: "wrap", value: h, type: target };
}

// `typeof x === "number"` (either operand order) as a tag test, or null when `b` is not that shape.
// Only a literal type name is a narrowing test; `typeof x === y` compares strings like any `===`.
const TYPEOF_NAMES = new Set<TypeTest>([
  "number",
  "string",
  "boolean",
  "undefined",
  "object",
  "function",
  "bigint",
  "symbol",
]);

export function typeofTest(b: ts.BinaryExpression, ctx: LowerCtx): HExpr | null {
  const pick = (t: ts.Expression, lit: ts.Expression): HExpr | null => {
    let inner = t;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    if (!ts.isTypeOfExpression(inner) || !ts.isStringLiteral(lit)) return null;
    if (!TYPEOF_NAMES.has(lit.text as TypeTest)) return null;
    return {
      kind: "typeIs",
      value: lowerExpr(inner.expression, ctx),
      test: lit.text as TypeTest,
      type: VT.boolean,
    };
  };
  return pick(b.left, b.right) ?? pick(b.right, b.left);
}

// An array literal element (or rest argument) in the array's element representation.
export function coerceElement(el: ArrayElement, arrayType: ValueType): ArrayElement {
  if (el.spread || arrayType.kind !== "array") return el;
  const element = arrayType.element;
  // Only a Value element needs a conversion here: the other element kinds keep the representation
  // the literal's own type gave them, which is what resolveType chose the array type from.
  if (element.kind !== "value" && el.value.type.kind !== "value") return el;
  return { spread: false, value: coerceToTarget(el.value, element) };
}
