// Math.* builtin calls → libm (floor/ceil/trunc/sqrt/fabs/pow) or a runtime helper (round/sign,
// whose JS semantics differ from C). All operate on doubles. The supported set is mirrored by the
// validator's Math allowlist (CS1220); an unsupported method never reaches here.

import { ice } from "../diagnostics.js";
import { fimm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import { type Ctx } from "./expr.js";
import { evalNumber } from "./numbers.js";

const MATH_UNARY: Record<string, string> = {
  floor: "@floor",
  ceil: "@ceil",
  trunc: "@trunc",
  abs: "@fabs",
  sqrt: "@sqrt",
  round: "@cs_math_round",
  sign: "@cs_math_sign",
};

export function evalMathCall(expr: Extract<HExpr, { kind: "mathCall" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalNumber(a, ctx));
  const unary = MATH_UNARY[expr.fn];
  if (unary) return ctx.fn.call(unary, T.double, [args[0]!]);
  if (expr.fn === "pow") return ctx.fn.call("@pow", T.double, [args[0]!, args[1]!]);
  // Math.max/min: variadic, folded pairwise. No args → ∓Infinity identity (JS spec).
  if (expr.fn === "max" || expr.fn === "min") {
    const runtimeFn = expr.fn === "max" ? "@cs_math_max2" : "@cs_math_min2";
    if (args.length === 0) return fimm(expr.fn === "max" ? -Infinity : Infinity);
    return args.reduce((acc, a) => ctx.fn.call(runtimeFn, T.double, [acc, a]));
  }
  return ice(`codegen: Math.${expr.fn} not supported yet`);
}
