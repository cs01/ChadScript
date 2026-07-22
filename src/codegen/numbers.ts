// Number-domain codegen: the number-typed expression dispatcher plus arithmetic and JS int32
// bitwise/shift ops. JS numbers are IEEE-754 f64, so arithmetic maps to LLVM float instructions;
// bitwise ops coerce through ToInt32. Split out of expr.ts; generic evaluators are imported back.

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr, BinaryOp } from "../hir/nodes.js";
import {
  type Ctx,
  evalValue,
  evalString,
  evalArrayPtr,
  evalLogical,
  evalNumberConvert,
  boxSlot,
  lookupVar,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
} from "./expr.js";
import { evalArrayHof, evalArraySearch } from "./array.js";
import { evalMapPtr, evalSetPtr } from "./collections.js";
import { evalMathCall } from "./math.js";
import { evalMemberGet } from "./objects.js";
import { evalCoalesce, evalUnwrap } from "./optional.js";
import { evalStrMethod } from "./strings.js";

// Evaluate a number-typed HExpr to a double Value.
export function evalNumber(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "numberLit":
      return fimm(expr.value);

    case "varRef":
      return ctx.fn.load(T.double, lookupVar(expr.name, ctx).ptr);

    case "call":
      return evalCall(expr, ctx);

    case "mathCall":
      return evalMathCall(expr, ctx);

    case "runtimeCall":
      // A direct runtime-entry call (parseInt/parseFloat). Args are passed positionally.
      return ctx.fn.call(`@${expr.fn}`, T.double, [...expr.args.map((a) => evalValue(a, ctx))]);

    case "strLen":
      return ctx.fn.sitofp(ctx.fn.call("@cs_str_len", T.i32, [evalString(expr.str, ctx)]));

    case "strMethod":
      return evalStrMethod(expr, ctx);

    case "coalesce":
      return evalCoalesce(expr, ctx);

    case "unwrap":
      return evalUnwrap(expr, ctx);

    case "arraySearch":
      return evalArraySearch(expr.array, expr.value, expr.elementType, expr.wantIndex, ctx);

    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);

    case "arrayHof":
      return evalArrayHof(expr, ctx); // reduce → number

    case "mapSize":
      return ctx.fn.sitofp(ctx.fn.call("@cs_map_size", T.i32, [evalMapPtr(expr.map, ctx)]));

    case "setSize":
      return ctx.fn.sitofp(ctx.fn.call("@cs_set_size", T.i32, [evalSetPtr(expr.set, ctx)]));

    case "convert": // `Number(x)`
      return evalNumberConvert(expr.value, ctx);

    case "arrayLen":
      // JS .length is a number; the runtime returns an i32 count.
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_len", T.i32, [evalArrayPtr(expr.array, ctx)]));

    case "arrayPush": {
      // push returns the new length (a number). Box the value into a slot first.
      const arr = evalArrayPtr(expr.array, ctx);
      const slot = boxSlot(evalValue(expr.value, ctx), expr.elementType, ctx);
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_push", T.i32, [arr, slot]));
    }

    case "memberGet":
      return evalMemberGet(expr, ctx);

    case "logical":
      return evalLogical(expr, ctx);

    case "unary": {
      const op = expr.op;
      switch (op) {
        case "neg":
          return ctx.fn.fneg(evalNumber(expr.operand, ctx));
        case "pos":
          return evalNumber(expr.operand, ctx); // unary + on a number is identity
        case "bnot":
          // ~a = ToInt32(a) ^ -1, back to double.
          return ctx.fn.sitofp(ctx.fn.ixor(toInt32(expr.operand, ctx), imm(T.i32, -1)));
        default:
          return ice(`evalNumber: unhandled unary op ${op} in number domain`);
      }
    }

    case "binary":
      return evalArithOrBitwise(expr, ctx);

    case "boolLit":
    case "stringLit":
      return ice(`evalNumber: got a ${expr.kind} in the number domain`);

    default:
      return ice(`evalNumber: unhandled expression ${(expr as { kind: string }).kind}`);
  }
}

// A number-typed binary op: floating arithmetic, or JS int32 bitwise/shift.
export function evalArithOrBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  switch (expr.op) {
    case "add":
      return ctx.fn.fadd(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "sub":
      return ctx.fn.fsub(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "mul":
      return ctx.fn.fmul(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "div":
      return ctx.fn.fdiv(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "rem":
      return ctx.fn.frem(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    default:
      return evalBitwise(expr, ctx);
  }
}

// JS int32 bitwise/shift ops. Both operands go through ToInt32; shifts mask the count to 5
// bits; the result reinterprets the 32 bits back to a double (signed, except `>>>` unsigned).
export function evalBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const ai = toInt32(expr.left, ctx);
  const bi = toInt32(expr.right, ctx);
  const count = () => ctx.fn.iand(bi, imm(T.i32, 31)); // JS masks shift count to 0..31
  switch (expr.op) {
    case "band":
      return ctx.fn.sitofp(ctx.fn.iand(ai, bi));
    case "bor":
      return ctx.fn.sitofp(ctx.fn.ior(ai, bi));
    case "bxor":
      return ctx.fn.sitofp(ctx.fn.ixor(ai, bi));
    case "shl":
      return ctx.fn.sitofp(ctx.fn.shl(ai, count()));
    case "shr":
      return ctx.fn.sitofp(ctx.fn.ashr(ai, count())); // arithmetic (sign-propagating)
    case "ushr":
      return ctx.fn.uitofp(ctx.fn.lshr(ai, count())); // logical; result is unsigned
    default:
      return ice(`evalBitwise: not a bitwise op: ${expr.op}`);
  }
}

// ToInt32(expr): evaluate to a double, then coerce via the runtime helper to an i32.
export function toInt32(expr: HExpr, ctx: Ctx): Value {
  return ctx.fn.call("@cs_to_int32", T.i32, [evalNumber(expr, ctx)]);
}
