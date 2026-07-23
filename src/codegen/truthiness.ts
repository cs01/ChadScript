// JS truthiness and the explicit conversions built on it: `&&`/`||` value semantics, `Number(x)`,
// `Boolean(x)`. These share one rule — what counts as truthy — which is why they live together and
// apart from the per-type evaluators. Split out of expr.ts.

import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import { type Ctx, evalValue, evalBool, evalString, irTypeOf } from "./expr.js";
import { evalNumber } from "./numbers.js";

// JS truthiness of an expression → i1 (evaluates the expression once).
export function toBool(expr: HExpr, ctx: Ctx): Value {
  return truthyOfValue(evalValue(expr, ctx), expr.type, ctx);
}

// JS truthiness of an ALREADY-computed Value → i1. Used where re-evaluating the expression
// would repeat side effects (e.g. the left operand of &&/||). Matches JS: number truthy iff
// != 0 and not NaN (ordered `one` vs 0 is false for both 0 and NaN); boolean is itself.
export function truthyOfValue(v: Value, vt: ValueType, ctx: Ctx): Value {
  switch (vt.kind) {
    case "boolean":
      return v;
    case "number":
      return ctx.fn.fcmp("one", v, fimm(0));
    case "string": {
      // JS: a string is truthy iff its length > 0 (only "" is falsy). cs_str_len is byte length,
      // ASCII-exact per the subset; NUL bytes count, so "\0" is truthy — matching Node.
      const len = ctx.fn.call("@cs_str_len", T.i32, [v]);
      return ctx.fn.icmp("ne", len, imm(T.i32, 0));
    }
    default:
      return ice(`truthiness: ${vt.kind} not supported yet`);
  }
}

// Short-circuiting `&&` / `||` with JS value semantics: the result is one of the operands.
// Implemented with a result slot (mem2reg promotes it to a phi at -O2), so the right operand
// is evaluated only when the left doesn't decide the outcome.
export function evalLogical(expr: Extract<HExpr, { kind: "logical" }>, ctx: Ctx): Value {
  const irt = irTypeOf(expr.type);
  const slot = ctx.fn.alloca(irt);
  const leftVal = evalValue(expr.left, ctx);
  ctx.fn.store(leftVal, slot); // default result = left
  const leftTruthy = truthyOfValue(leftVal, expr.left.type, ctx);

  const rightB = ctx.fn.newBlock("logic.right");
  const doneB = ctx.fn.newBlock("logic.done");
  // `&&`: evaluate right only if left is truthy. `||`: only if left is falsy.
  if (expr.op === "and") ctx.fn.brCond(leftTruthy, rightB, doneB);
  else ctx.fn.brCond(leftTruthy, doneB, rightB);

  ctx.fn.switchTo(rightB);
  ctx.fn.store(evalValue(expr.right, ctx), slot); // result = right
  ctx.fn.br(doneB);

  ctx.fn.switchTo(doneB);
  return ctx.fn.load(irt, slot);
}

// `Number(x)`: number → identity; boolean → 1/0; string → the ECMAScript StringToNumber parse.
export function evalNumberConvert(value: HExpr, ctx: Ctx): Value {
  switch (value.type.kind) {
    case "number":
      return evalNumber(value, ctx);
    case "boolean":
      return ctx.fn.uitofp(ctx.fn.zextI1ToI32(evalBool(value, ctx)));
    case "string":
      return ctx.fn.call("@cs_string_to_number", T.double, [evalString(value, ctx)]);
    default:
      return ice(`Number(): conversion from ${value.type.kind} not supported yet`);
  }
}

// `Boolean(x)`: JS truthiness. number → not NaN and not 0 (`fcmp one` is ordered, so NaN→false);
// string → non-empty; boolean → identity.
export function evalBooleanConvert(value: HExpr, ctx: Ctx): Value {
  switch (value.type.kind) {
    case "boolean":
      return evalBool(value, ctx);
    case "number":
      return ctx.fn.fcmp("one", evalNumber(value, ctx), fimm(0));
    case "string":
      return ctx.fn.icmp(
        "ne",
        ctx.fn.call("@cs_str_len", T.i32, [evalString(value, ctx)]),
        imm(T.i32, 0),
      );
    default:
      return ice(`Boolean(): conversion from ${value.type.kind} not supported yet`);
  }
}
