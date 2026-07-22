// Expression lowering: HExpr → IR Value. Consumes HIR only — NO `typescript` import, no
// checker. Each HExpr already carries its resolved ValueType (stamped by lower/), so dispatch
// is on the HIR shape alone. JS number arithmetic is IEEE-754 f64, so the number domain maps
// straight to LLVM float instructions.

import { ice } from "../diagnostics.js";
import { fimm, type Value, type ModuleBuilder, type FuncBuilder } from "../ir/builder.js";
import type { HExpr } from "../hir/nodes.js";

export interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
}

// Evaluate a number-typed HExpr to a double Value.
export function evalNumber(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "numberLit":
      return fimm(expr.value);

    case "unary": {
      const op = expr.op;
      const operand = evalNumber(expr.operand, ctx);
      switch (op) {
        case "neg":
          return ctx.fn.fneg(operand);
        case "pos":
          return operand; // unary + on a number is identity
        default:
          return ice(`evalNumber: unhandled unary op ${op}`);
      }
    }

    case "binary": {
      const op = expr.op;
      const a = evalNumber(expr.left, ctx);
      const b = evalNumber(expr.right, ctx);
      switch (op) {
        case "add":
          return ctx.fn.fadd(a, b);
        case "sub":
          return ctx.fn.fsub(a, b);
        case "mul":
          return ctx.fn.fmul(a, b);
        case "div":
          return ctx.fn.fdiv(a, b);
        case "rem":
          return ctx.fn.frem(a, b);
        default:
          return ice(`evalNumber: unhandled binary op ${op}`);
      }
    }

    case "stringLit":
      return ice("evalNumber: got a string expression in the number domain");

    default:
      return ice(`evalNumber: unhandled expression ${(expr as { kind: string }).kind}`);
  }
}
