// `x!`, checked. tsc erases the assertion and Node runs on with whatever `x` was; here a value whose
// representation changes under the assertion (`T | undefined` to `T`) is tested, and a nullish one
// throws a TypeError instead of being read as a T. That differs from Node only in a program whose
// assertion is false, where Node would carry `undefined` into code typed for a T (an accepted
// amendment to the exact-Node contract, PLAN.md constitution item 6).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { ERROR_KINDS } from "./errors.js";
import { type LowerCtx, lowerExpr } from "./lower.js";
import { valueTypeOfTsType } from "./type-translation.js";

export function lowerNonNull(expr: ts.NonNullExpression, ctx: LowerCtx): HExpr {
  const inner = lowerExpr(expr.expression, ctx);
  const target = valueTypeOfTsType(ctx.checker.getTypeAtLocation(expr), expr, ctx.checker);
  // Already non-nullable, or one Value word on both sides (an erased `T | undefined` read as T):
  // no representation changes, so the assertion has no run-time effect, exactly as in JS.
  if (inner.type.kind !== "optional" && inner.type.kind !== "value") return inner;
  if (inner.type.kind === "value" && target.kind === "value") return inner;
  if (target.kind === "optional" || target.kind === "value") {
    return ice(`lower: x! from ${inner.type.kind} to ${target.kind}`);
  }
  const text = expr.expression.getText();
  const shown = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  return {
    kind: "coalesce",
    left: inner,
    right: {
      kind: "nonNullFail",
      errorKind: ERROR_KINDS.TypeError,
      message: `non-null assertion failed: \`${shown}\` is null or undefined`,
      type: target,
    },
    type: target,
  };
}
