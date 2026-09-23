// Expression type resolution: the ValueType an expression should be lowered AT, which is not
// always the type tsc reports. Literals need their contextual (declared) type to pick up a named
// shape, and several builtin signatures type their result in a way our value model does not use
// (`Object.values` as any[], a `.concat()` argument as ConcatArray<T>). Split out of lower.ts.

import ts from "typescript";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx } from "./lower.js";
import {
  UnrepresentableTypeError,
  valueTypeOf,
  valueTypeOfTsType,
  arrayElementType,
} from "./type-translation.js";
import { ice } from "../diagnostics.js";

// Whether array slots of element types `a` and `b` hold the same words. Object records are pointers
// whatever their static type (fields are read through the record's own shape), so any two object
// types agree; a Value union differs from every concrete kind; containers compare their contents.
function sameSlots(a: ValueType, b: ValueType, depth = 0): boolean {
  if (a.kind !== b.kind) return false;
  if (depth > 4) return true;
  if (a.kind === "array" && b.kind === "array") return sameSlots(a.element, b.element, depth + 1);
  if (a.kind === "optional" && b.kind === "optional") return sameSlots(a.inner, b.inner, depth + 1);
  return true;
}

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
    const ctxT = checker.getContextualType(expr);
    const ctxElem = ctxT ? arrayElementType(ctxT, checker) : undefined;
    if (usable(ownElem)) {
      // The literal's own element type can be unrepresentable where the slot's is fine:
      // `[[]]` is `never[][]`, and `[["a"], [1]]` is `(string[] | number[])[]` even when it
      // initializes a `(number | string)[][]`. The elements are built in the slot's
      // representation then, so only a literal with no usable context has to be representable.
      let own: ValueType | null = null;
      try {
        own = valueTypeOfTsType(ownElem!, expr, checker);
      } catch (e) {
        if (!(e instanceof UnrepresentableTypeError) || !usable(ctxElem)) throw e;
      }
      // `const xs: (number | string)[] = [1, 2]`: the literal's own element type is `number`, but
      // the array it builds IS the slot's array (shared by reference from then on), so its slots
      // must already be in the slot's element representation (Value words, not raw doubles).
      if (usable(ctxElem)) {
        const want = valueTypeOfTsType(ctxElem!, expr, checker);
        if (own === null || !sameSlots(own, want)) return VT.array(want);
      }
      return VT.array(own ?? ice("resolveType: array literal without an element type"));
    }
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
    let resolved: ValueType;
    try {
      resolved = valueTypeOfTsType(t, expr, checker);
    } catch (e) {
      // A context that describes no layout (`Object.keys(o: object)`) says nothing about the
      // literal's fields: build the literal's own shape.
      if (!(e instanceof UnrepresentableTypeError) || t === checker.getTypeAtLocation(expr))
        throw e;
      resolved = valueTypeOfTsType(checker.getTypeAtLocation(expr), expr, checker);
    }
    // Assigning into a `T | null` slot (`let list: N | null = ...`) makes the CONTEXTUAL type the
    // union, so the literal's own type comes back as optional<object>. The literal still builds a
    // plain record; the surrounding coerceToTarget is what wraps it for the optional slot.
    if (resolved.kind === "optional" && resolved.inner.kind === "object") return resolved.inner;
    // Into a Value-union slot (`Pt | string`), the union has no one object shape to build; the
    // literal builds its own, and the flow into the slot boxes it.
    if (resolved.kind === "value") {
      return valueTypeOfTsType(checker.getTypeAtLocation(expr), expr, checker);
    }
    return resolved;
  }
  return valueTypeOf(expr, ctx);
}
