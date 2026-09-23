// Lowering of calls to generic declarations: arguments converted into the callee's erased
// parameter representations and results back into the instantiation's (plans: generics.ts).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { ArrayElement, HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, coerceToTarget } from "./lower.js";
import { lowerArrayElement } from "./declarations.js";
import {
  type GenericSignature,
  applyArgumentPlan,
  applyResultPlan,
  genericSignatureOf,
  planArgument,
  planResult,
  slotIdentical,
} from "./generics.js";

// `[a, ...b]` built directly in the erased array representation `t`: elements boxed into T's word,
// spread sources copied through a conversion (a spread copies anyway, so nothing can notice).
function lowerArrayLiteralAt(arg: ts.Expression, t: ValueType, ctx: LowerCtx): HExpr {
  let lit = arg;
  while (ts.isParenthesizedExpression(lit)) lit = lit.expression;
  if (!ts.isArrayLiteralExpression(lit) || t.kind !== "array") {
    return ice("lower: generic literal plan on a non-literal");
  }
  const element = t.element;
  const elements = lit.elements.map((e): ArrayElement => {
    const el = lowerArrayElement(e, ctx);
    if (!el.spread) return { spread: false, value: coerceToTarget(el.value, element) };
    const src = el.value.type;
    if (src.kind === "array" && !slotIdentical(src.element, element)) {
      return { spread: true, value: { kind: "convertArray", value: el.value, type: t } };
    }
    return el;
  });
  return { kind: "arrayLit", elements, type: t };
}

function lowerOneArg(arg: ts.Expression, erased: ValueType, inst: ValueType, ctx: LowerCtx): HExpr {
  const plan = planArgument(erased, inst, arg);
  // The literal plan lowers the literal itself (lowering twice would lift its lambdas twice).
  if (plan.kind === "literal") return lowerArrayLiteralAt(arg, erased, ctx);
  return applyArgumentPlan(plan, lowerExpr(arg, ctx), erased, coerceToTarget, () =>
    ice("lower: literal plan"),
  );
}

export function lowerGenericArgs(
  call: ts.CallExpression | ts.NewExpression,
  g: GenericSignature,
  ctx: LowerCtx,
): HExpr[] {
  const args = call.arguments ?? [];
  if (!g.rest) return args.map((a, i) => lowerOneArg(a, g.erased[i]!, g.inst[i]!, ctx));
  // A rest parameter packs the trailing arguments into one array in the ERASED representation.
  const fixed = g.erased.length - 1;
  const restT = g.erased[fixed]!;
  const restInst = g.inst[fixed]!;
  if (restT.kind !== "array" || restInst.kind !== "array") return ice("lower: rest not an array");
  const packed = args.slice(fixed).map((a): ArrayElement => {
    if (ts.isSpreadElement(a)) {
      const el = lowerArrayElement(a, ctx);
      const src = el.value.type;
      if (src.kind === "array" && !slotIdentical(src.element, restT.element)) {
        return { spread: true, value: { kind: "convertArray", value: el.value, type: restT } };
      }
      return el;
    }
    return { spread: false, value: lowerOneArg(a, restT.element, restInst.element, ctx) };
  });
  return [
    ...args.slice(0, fixed).map((a, i) => lowerOneArg(a, g.erased[i]!, g.inst[i]!, ctx)),
    { kind: "arrayLit", elements: packed, type: restT },
  ];
}

// A call in value position: `build` makes the call node at the type the CALLEE returns (the erased
// return for a generic declaration), and the result is converted to `inst`, the type tsc gives the
// call here. Non-generic calls are built at `inst` unchanged.
export function lowerCallValue(
  call: ts.CallExpression | ts.NewExpression,
  inst: ValueType,
  ctx: LowerCtx,
  build: (calleeType: ValueType) => HExpr,
): HExpr {
  const g = genericSignatureOf(call, ctx.checker);
  if (!g || g.erasedRet === null) return build(inst);
  const plan = planResult(g.erasedRet, inst, g.decl, ctx.checker);
  return applyResultPlan(plan, build(g.erasedRet), inst, coerceToTarget);
}
