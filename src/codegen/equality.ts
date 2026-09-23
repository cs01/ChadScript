// `===` / `!==` and the relational operators: comparisons dispatched on the operands' shared type.
// Split out of expr.ts.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr, BinaryOp } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type Ctx, evalBool, evalString, evalValue } from "./expr.js";
import { evalNumber } from "./numbers.js";
import { evalValueWord, valueStrictEq } from "./value-ops.js";
import { evalOptionalEquality, evalBothOptionalEquality } from "./optional.js";

// Strict-equality (`===`) of two already-computed Values, dispatched on their shared type.
// Matches JS: numbers via ordered fcmp oeq (NaN===NaN false), booleans via icmp, strings via
// the runtime string compare. Shared by `switch` and array `.includes`/`.indexOf`.
export function emitStrictEq(a: Value, b: Value, type: ValueType, ctx: Ctx): Value {
  switch (type.kind) {
    case "number":
      return ctx.fn.fcmp("oeq", a, b);
    case "boolean":
      return ctx.fn.icmp("eq", a, b);
    case "string":
      return ctx.fn.icmp("ne", ctx.fn.call("@cs_str_eq", T.i32, [a, b]), imm(T.i32, 0));
    case "value":
      return valueStrictEq(a, b, ctx);
    // Identity. Every object, array, Map and Set is one heap record for its whole life, so its
    // pointer is its identity.
    case "object":
    case "array":
    case "map":
    case "set":
      return ctx.fn.icmp("eq", a, b);
    case "function":
      return functionIdentityEq(a, b, ctx);
    default:
      return ice(`emitStrictEq: ${type.kind} not supported`);
  }
}

// Two closure records are the same JS function when they are one record, or when both carry the
// same identity token in their env word (two wrappers of one named function or builtin at
// different signatures, codegen/cells.ts). An ordinary closure's env is null or its own fresh
// capture block, so the token test can only match records that stand for one function.
export function functionIdentityEq(a: Value, b: Value, ctx: Ctx): Value {
  const envA = ctx.fn.load(T.i64, ctx.fn.gepSlot(a, 1));
  const envB = ctx.fn.load(T.i64, ctx.fn.gepSlot(b, 1));
  const sameToken = ctx.fn.logicalAnd(
    ctx.fn.icmp("eq", envA, envB),
    ctx.fn.icmp("ne", envA, imm(T.i64, 0)),
  );
  return ctx.fn.logicalOr(ctx.fn.icmp("eq", a, b), sameToken);
}

const RELATIONAL: Partial<Record<BinaryOp, string>> = {
  lt: "olt",
  gt: "ogt",
  le: "ole",
  ge: "oge",
};

export function evalComparison(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const op = expr.op;
  const relPred = RELATIONAL[op];
  if (relPred) {
    // String relational operands are gated OUT of the subset at validate (CS1216): byte-order
    // comparison diverges from Node's UTF-16 code-unit order on non-ASCII. Only numbers reach here.
    // Ordered predicate → NaN yields false, matching JS.
    return ctx.fn.fcmp(relPred, evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
  }
  if (op === "eq" || op === "ne") {
    const operandType = expr.left.type.kind;
    // A Value operand: lower boxed the other side too, so this compares two words.
    if (operandType === "value") {
      const eq = valueStrictEq(evalValueWord(expr.left, ctx), evalValueWord(expr.right, ctx), ctx);
      return op === "eq" ? eq : ctx.fn.logicalNot(eq);
    }
    // Optional vs concrete (`str.at(i) !== "h"`). One side is `T | undefined`, the other a plain
    // inner value.
    const rightOpt = expr.right.type.kind === "optional";
    if ((operandType === "optional") !== rightOpt) {
      const optExpr = operandType === "optional" ? expr.left : expr.right;
      const otherExpr = operandType === "optional" ? expr.right : expr.left;
      return evalOptionalEquality(optExpr, otherExpr, op === "ne", ctx);
    }
    if (operandType === "optional") return evalBothOptionalEquality(expr, op === "ne", ctx);
    if (
      operandType === "object" ||
      operandType === "array" ||
      operandType === "map" ||
      operandType === "set" ||
      operandType === "function"
    ) {
      const eq = emitStrictEq(
        evalValue(expr.left, ctx),
        evalValue(expr.right, ctx),
        expr.left.type,
        ctx,
      );
      return op === "eq" ? eq : ctx.fn.logicalNot(eq);
    }
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
    if (operandType === "string") {
      // Value-position `===`/`!==` on strings: cs_str_eq returns 1 when equal (length + bytes,
      // NUL-safe — same primitive `switch` uses). `eq` is true when cs_str_eq != 0; `ne` inverts.
      const cmp = ctx.fn.call("@cs_str_eq", T.i32, [
        evalString(expr.left, ctx),
        evalString(expr.right, ctx),
      ]);
      return ctx.fn.icmp(op === "eq" ? "ne" : "eq", cmp, imm(T.i32, 0));
    }
    return ice(`evalBool: ${op} on ${operandType} operands not supported yet`);
  }
  return ice(`evalBool: binary op ${op} is not a comparison`);
}
