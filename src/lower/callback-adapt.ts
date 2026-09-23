// Callbacks handed to the array methods (map, forEach, filter, reduce, sort, ...) and to Map/Set
// forEach are called by generated loops with the builtin's own argument representations: the
// element, the index as a number, the array (codegen/array.ts, codegen/collections.ts). tsc lets a
// callback declare a WIDER parameter (`(x: number | string) => ...` over a number[]), which is a
// Value word here, so passing the raw double would be read as a different value. Such a callback
// is wrapped in an adapter closure (adaptClosure) that boxes each argument into the parameter's
// representation. The validator rejects the parameter types no word conversion reaches
// (validate/form-rules.ts), with the same plan function, so the two cannot drift.

import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { slotIdentical } from "./generics.js";

type ParamPlan = "keep" | "box" | null;

// How an argument of representation `passed` reaches a parameter declared as `declared`.
function paramPlan(declared: ValueType, passed: ValueType): ParamPlan {
  // Same machine type (a closure's parameters are typed IR arguments, so an object pointer and a
  // Value word differ here even though they share a slot).
  if (declared.kind === passed.kind && slotIdentical(declared, passed)) return "keep";
  if (declared.kind !== "value") return null;
  switch (passed.kind) {
    case "number":
    case "boolean":
    case "string":
    case "function":
    case "object":
    case "optional":
      return "box";
    case "array":
    case "map":
    case "set":
      // The Value arm unboxes it at its member type, which must hold the same slots.
      return declared.members.some((m) => slotIdentical(m, passed)) ? "box" : null;
    default:
      return null;
  }
}

// Why a callback declaring `declared` cannot be called with `passed` arguments, or null.
export function callbackParamProblem(
  declared: readonly ValueType[],
  passed: readonly ValueType[],
): string | null {
  if (declared.length > passed.length) return "it declares more parameters than are passed";
  for (let i = 0; i < declared.length; i++) {
    if (paramPlan(declared[i]!, passed[i]!) === null) {
      return `its parameter ${i + 1} cannot receive the value passed to it`;
    }
  }
  return null;
}

// `cb`, or an adapter taking `passed` arguments when a declared parameter is wider.
export function adaptCallback(cb: HExpr, passed: readonly ValueType[]): HExpr {
  const t = cb.type;
  if (t.kind !== "function") return cb;
  if (t.params.every((p, i) => passed[i] !== undefined && paramPlan(p, passed[i]!) === "keep")) {
    return cb;
  }
  return {
    kind: "adaptClosure",
    value: cb,
    type: { kind: "function", params: passed.slice(0, t.params.length), ret: t.ret },
  };
}
