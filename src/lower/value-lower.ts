// Lowering support for Value unions (ValueType `value`): the explicit box/unbox conversions at
// every place a value flows into a slot, and the `typeof x === "..."` tag test. Split out of
// lower.ts; lowerExpr is imported back (circular, resolved at call time).

import ts from "typescript";
import type { ArrayElement, HExpr, TypeTest } from "../hir/nodes.js";
import { VT, optionalOf } from "../hir/types.js";
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

// The Value union two optionals are compared in: both inner kinds plus undefined and null.
export function bothOptional(a: ValueType, b: ValueType): ValueType {
  if (a.kind !== "optional" || b.kind !== "optional") return a;
  const members: ValueType[] = [a.inner];
  if (b.inner.kind !== a.inner.kind) members.push(b.inner);
  return { kind: "value", members: [...members, VT.undefined, VT.null] };
}

export function isNullishType(t: ValueType): boolean {
  return t.kind === "null" || t.kind === "undefined";
}

// `left ?? right` where the left is a Value (nullish is a word test) or an optional whose result is
// a union (`a ?? b` with `a: string | undefined`, `b: number`), which is boxed first so its present
// value lands in the union as a word too. The fallback lands in the result's representation.
export function valueCoalesce(left: HExpr, right: HExpr, type: ValueType): HExpr {
  const word: HExpr =
    left.type.kind === "value" ? left : { kind: "box", value: left, type: withNullish(type) };
  return { kind: "coalesce", left: word, right: coerceToTarget(right, type), type };
}

// A Value union that can also hold undefined and null (the left of `??` before the test).
function withNullish(t: ValueType): ValueType {
  if (t.kind !== "value") return t;
  const extra = [VT.undefined, VT.null].filter((n) => !t.members.some((m) => m.kind === n.kind));
  return { kind: "value", members: [...t.members, ...extra] };
}

// A read that yields `inner | undefined` through an optional pointer (`arr.pop()`, `arr.at(i)`,
// `arr.find(f)`, `map.get(k)`), stamped with the site's type. For a Value `inner` the site's type is
// the union itself (a Value absorbs `undefined`), which the optional-pointer machinery does not
// produce; so the node keeps its optional pointer form and an explicit box turns it into the word,
// unboxed again where tsc narrowed the site. An optional `inner` (`(string | null)[]`) needs the
// same route: the read yields an optional of an optional (the box holds the element's own optional
// pointer), which only its Value word flattens back into one `string | null | undefined`.
export function optionalRead(node: HExpr, inner: ValueType, siteType: ValueType): HExpr {
  if (inner.kind !== "value" && inner.kind !== "optional") {
    return { ...node, type: siteType } as HExpr;
  }
  const raw = { ...node, type: { kind: "optional", inner } } as HExpr;
  const wordType: ValueType =
    inner.kind === "optional"
      ? { kind: "value", members: [inner.inner, VT.undefined, VT.null] }
      : optionalOf(inner);
  const word: HExpr = { kind: "box", value: raw, type: wordType };
  if (siteType.kind === "value" || siteType.kind === "undefined" || siteType.kind === "null") {
    return word;
  }
  return { kind: "unbox", value: word, type: siteType };
}

// An array literal element (or rest argument) in the array's element representation.
export function coerceElement(el: ArrayElement, arrayType: ValueType): ArrayElement {
  if (el.spread || arrayType.kind !== "array") return el;
  const element = arrayType.element;
  // A Value or optional element slot needs its element converted (boxed, wrapped, or a bare
  // `null`/`undefined` made a sentinel); every other element kind is already in the representation
  // resolveType chose the array type from.
  const converts = (k: ValueType["kind"]): boolean => k === "value" || k === "optional";
  if (!converts(element.kind) && !converts(el.value.type.kind)) return el;
  return { spread: false, value: coerceToTarget(el.value, element) };
}
