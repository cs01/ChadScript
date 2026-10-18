// Math.* builtin calls → libm (floor/ceil/trunc/sqrt/fabs/pow) or a runtime helper (round/sign/
// imul/clz32/fround, whose JS semantics differ from C). All operate on doubles. The supported set is mirrored by the
// validator's Math allowlist (CS1220); an unsupported method never reaches here.

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
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
  clz32: "@cs_math_clz32",
  fround: "@cs_math_fround",
};

export function evalMathCall(expr: Extract<HExpr, { kind: "mathCall" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalNumber(a, ctx));
  const unary = MATH_UNARY[expr.fn];
  if (unary) return ctx.fn.call(unary, T.double, [args[0]!]);
  if (expr.fn === "pow") return ctx.fn.call("@pow", T.double, [args[0]!, args[1]!]);
  if (expr.fn === "imul") return ctx.fn.call("@cs_math_imul", T.double, [args[0]!, args[1]!]);
  if (expr.fn === "hypot") return hypot(args, ctx);
  // Math.max/min: variadic, folded pairwise. No args → ∓Infinity identity (JS spec).
  if (expr.fn === "max" || expr.fn === "min") {
    const runtimeFn = expr.fn === "max" ? "@cs_math_max2" : "@cs_math_min2";
    if (args.length === 0) return fimm(expr.fn === "max" ? -Infinity : Infinity);
    return args.reduce((acc, a) => ctx.fn.call(runtimeFn, T.double, [acc, a]));
  }
  return ice(`codegen: Math.${expr.fn} not supported yet`);
}

// Math.hypot, V8's algorithm (builtins/math.tq MathHypot) rather than libm's hypot, whose last bit
// differs from Node on a large share of inputs: Infinity wins over NaN, NaN over everything else;
// otherwise scale by the largest magnitude and Kahan-sum the squares. Only sqrt and the four basic
// operations are used, so the result is bit-identical to Node's on every platform. Every argument
// is already evaluated; the special cases are selects over the computed sum.
function hypot(args: Value[], ctx: Ctx): Value {
  if (args.length === 0) return fimm(0);
  const f = ctx.fn;
  const abs = args.map((a) => f.call("@fabs", T.double, [a]));
  let max: Value = fimm(0);
  let anyNaN: Value = imm(T.i1, 0);
  args.forEach((a, i) => {
    anyNaN = f.select(f.fcmp("uno", a, a), imm(T.i1, 1), anyNaN);
    max = f.select(f.fcmp("ogt", abs[i]!, max), abs[i]!, max);
  });
  let sum: Value = fimm(0);
  let comp: Value = fimm(0);
  for (const a of abs) {
    const n = f.fdiv(a, max);
    const summand = f.fsub(f.fmul(n, n), comp);
    const prelim = f.fadd(sum, summand);
    comp = f.fsub(f.fsub(prelim, sum), summand);
    sum = prelim;
  }
  const scaled = f.fmul(f.call("@sqrt", T.double, [sum]), max);
  const finite = f.select(f.fcmp("oeq", max, fimm(0)), fimm(0), scaled);
  const nanOrFinite = f.select(anyNaN, fimm(NaN), finite);
  return f.select(f.fcmp("oeq", max, fimm(Infinity)), fimm(Infinity), nanOrFinite);
}
