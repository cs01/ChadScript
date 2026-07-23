// Expression type resolution: the ValueType an expression should be lowered AT, which is not
// always the type tsc reports. Literals need their contextual (declared) type to pick up a named
// shape, and several builtin signatures type their result in a way our value model does not use
// (`Object.values` as any[], a `.concat()` argument as ConcatArray<T>). Split out of lower.ts.

import ts from "typescript";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx } from "./lower.js";
import { valueTypeOf, valueTypeOfTsType, arrayElementType } from "./type-translation.js";

// The checker is the oracle: map its resolved type to our ValueType. Anything outside the
// currently-supported domain is an ICE (the validator should have rejected it upstream).
export function resolveType(expr: ts.Expression, ctx: LowerCtx): ValueType {
  const checker = ctx.checker;
  // `this` has tsc's polymorphic ThisType (a type parameter); use the bound instance type.
  if (expr.kind === ts.SyntaxKind.ThisKeyword && ctx.currentThis) return ctx.currentThis.type;

  // Array literals: prefer the literal's own inferred type (the real element type). An empty
  // `[]` is `never[]` — fall back to the contextual/declared array type. The contextual type is
  // NOT trusted blindly: as a `.concat()` argument it is `ConcatArray<T>` (an interface, not
  // Array), which must not be mistaken for an object.
  if (ts.isArrayLiteralExpression(expr)) {
    // Ignore an element type that carries no representation (never/unknown/any) — e.g. from an
    // `unknown[]` contextual type (console.log's parameter).
    const usable = (t: ts.Type | undefined): boolean =>
      t !== undefined &&
      !(t.flags & (ts.TypeFlags.Never | ts.TypeFlags.Unknown | ts.TypeFlags.Any));
    const ownElem = arrayElementType(checker.getTypeAtLocation(expr), checker);
    if (usable(ownElem)) return VT.array(valueTypeOfTsType(ownElem!, expr, checker));
    const ctxT = checker.getContextualType(expr);
    const ctxElem = ctxT ? arrayElementType(ctxT, checker) : undefined;
    if (usable(ctxElem)) return VT.array(valueTypeOfTsType(ctxElem!, expr, checker));
    // An empty literal with no usable element type: the element type is irrelevant (nothing is
    // stored or formatted), so a harmless placeholder keeps `console.log([])` compiling.
    if (expr.elements.length === 0) return VT.array(VT.number);
    return valueTypeOfTsType(checker.getTypeAtLocation(expr), expr, checker);
  }

  // Object literals take their shape from the declared type (the named interface) when present,
  // but ignore an unknown/any contextual type (console.log's parameter) — use the literal's own
  // inferred shape then.
  if (ts.isObjectLiteralExpression(expr)) {
    const ct = checker.getContextualType(expr);
    const t =
      ct && !(ct.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any))
        ? ct
        : checker.getTypeAtLocation(expr);
    const resolved = valueTypeOfTsType(t, expr, checker);
    // Assigning into a `T | null` slot (`let list: N | null = ...`) makes the CONTEXTUAL type the
    // union, so the literal's own type comes back as optional<object>. The literal still builds a
    // plain record; the surrounding coerceToTarget is what wraps it for the optional slot.
    if (resolved.kind === "optional" && resolved.inner.kind === "object") return resolved.inner;
    return resolved;
  }
  return valueTypeOf(expr, ctx);
}
