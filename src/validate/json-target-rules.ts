// The JSON.parse target check rules.ts runs on an annotated `JSON.parse` declaration. Split out of
// rules.ts to keep that file under its size ceiling.

import ts from "typescript";
import type { ValueType } from "../hir/types.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";

// Whether a JSON.parse target contains a Value union with an object member: the union keeps no
// object layout (hir/types.ts ANY_OBJECT), so the parser would have no template to lay it out with.
export function unionWithObject(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): boolean {
  let root: ValueType;
  try {
    root = valueTypeOfTsType(t, node, checker);
  } catch (e) {
    if (e instanceof UnrepresentableTypeError) return false; // reported where it is declared
    throw e;
  }
  const seen = new Set<ValueType>();
  const walk = (v: ValueType): boolean => {
    if (seen.has(v)) return false;
    seen.add(v);
    switch (v.kind) {
      case "value":
        return v.members.some((m) => m.kind === "object" || walk(m));
      case "array":
        return walk(v.element);
      case "optional":
        return walk(v.inner);
      case "object":
        return v.shape.fields.some((f) => walk(f.type));
      default:
        return false;
    }
  };
  return walk(root);
}
