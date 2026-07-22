// Expression lowering: HExpr → IR Value. Consumes HIR only — NO `typescript` import, no
// checker. Each HExpr already carries its resolved ValueType (stamped by lower/), so dispatch
// is on the HIR shape alone. JS number arithmetic is IEEE-754 f64, so the number domain maps
// straight to LLVM float instructions.

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value, type ModuleBuilder, type FuncBuilder } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr, BinaryOp } from "../hir/nodes.js";

export interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
}

const RELATIONAL: Partial<Record<BinaryOp, string>> = {
  lt: "olt",
  gt: "ogt",
  le: "ole",
  ge: "oge",
};

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

    case "boolLit":
    case "stringLit":
      return ice(`evalNumber: got a ${expr.kind} in the number domain`);

    default:
      return ice(`evalNumber: unhandled expression ${(expr as { kind: string }).kind}`);
  }
}

// Evaluate a boolean-typed HExpr to an i1 Value.
export function evalBool(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "boolLit":
      return imm(T.i1, expr.value ? 1 : 0);

    case "binary":
      return evalComparison(expr, ctx);

    default:
      return ice(`evalBool: unhandled boolean expression ${expr.kind}`);
  }
}

function evalComparison(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const op = expr.op;
  const relPred = RELATIONAL[op];
  if (relPred) {
    // Relational operands are numbers (JS forbids `<` on booleans). Ordered predicate → NaN
    // yields false, matching JS.
    return ctx.fn.fcmp(relPred, evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
  }
  if (op === "eq" || op === "ne") {
    const operandType = expr.left.type.kind;
    if (operandType === "number") {
      // === → oeq (NaN===NaN false); !== → une (= !oeq, so NaN!==NaN true). Using ordered
      // `one` for !== would wrongly make NaN!==NaN false — a JS divergence.
      return ctx.fn.fcmp(
        op === "eq" ? "oeq" : "une",
        evalNumber(expr.left, ctx),
        evalNumber(expr.right, ctx),
      );
    }
    if (operandType === "boolean") {
      return ctx.fn.icmp(
        op === "eq" ? "eq" : "ne",
        evalBool(expr.left, ctx),
        evalBool(expr.right, ctx),
      );
    }
    return ice(`evalBool: ${op} on ${operandType} operands not supported yet`);
  }
  return ice(`evalBool: binary op ${op} is not a comparison`);
}
