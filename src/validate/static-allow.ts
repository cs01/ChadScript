// The namespace statics (`Math.floor`, `Object.keys`, …) lowering supports, as a default-deny
// allowlist the validator checks (rules.ts) and the subset doc lists (scripts/gen-subset.ts).

// Static (namespace) methods lowering supports, per global. A call `X.m(...)` with `X` in this
// table and `m` absent from its set is rejected (CS1220). Empty set = no static of that global is
// supported yet. Instance methods and the `X(...)` conversion calls are NOT gated here.
export const NAMESPACE_STATIC_ALLOW: Record<string, ReadonlySet<string>> = {
  Object: new Set(["keys", "values"]),
  Date: new Set(["now"]),
  Array: new Set(["isArray"]),
  Number: new Set(["isInteger", "isFinite", "isNaN"]),
  // Math methods codegen lowers (evalMathCall). The transcendental ones (sin/cos/exp/log/…) stay
  // rejected: Node's results for them differ between its versions (V8 swapped implementations)
  // and between arm64 and x86-64 builds of one version (the arm64 build fuses multiply-adds), in
  // the last bit on a few percent of inputs, so no single implementation matches "Node". random
  // is unseeded. Math CONSTANTS (Math.PI) are property reads, not calls — unaffected.
  Math: new Set([
    "floor",
    "ceil",
    "trunc",
    "abs",
    "sqrt",
    "round",
    "sign",
    "pow",
    "max",
    "min",
    "imul",
    "clz32",
    "fround",
    "hypot",
  ]),
  // Promise statics codegen lowers. `race`/`allSettled`/`reject` are later slices, so they reject
  // here until implemented.
  Promise: new Set(["resolve", "all"]),
};
