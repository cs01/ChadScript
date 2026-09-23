// Values of type `unknown`: a caught value or a builtin Error, both a pointer to a runtime CsThrown
// (runtime/errors.milo).

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr, TypeTest } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type Ctx, evalCall, evalCallClosure, evalString, lookupVar } from "./expr.js";
import { evalVirtualCall } from "./methods.js";
import { boxValue, unboxValue } from "./value.js";
import { membersOf, switchOnValue } from "./value-ops.js";

export function evalThrownPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "newError": {
      // The runtime copies the message; an absent one is "" (Node's `new Error().message`).
      const msg = expr.message ? evalString(expr.message, ctx) : ctx.mod.cstring("");
      return ctx.fn.call("@cs_new_error_kind", T.ptr, [imm(T.i32, expr.errorKind), msg]);
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);
    case "virtualCall":
      return evalVirtualCall(expr, ctx);
    default:
      return ice(`evalThrownPtr: unhandled error expression ${expr.kind}`);
  }
}

// A caught value is the value that was thrown, and a thrown string must behave as that string
// everywhere the subset admits a caught value: a CsThrown of kind 0 answers typeof, truthiness,
// equality and Number() from its text; an error (kind > 0) is an object compared by identity.
// Every CsThrown carries a message, so reading it before testing the kind is safe.

function thrownIsString(t: Value, ctx: Ctx): Value {
  const kind = ctx.fn.call("@cs_thrown_is_error", T.i32, [t]);
  return ctx.fn.icmp("eq", kind, imm(T.i32, 0));
}

function thrownText(t: Value, ctx: Ctx): Value {
  return ctx.fn.call("@cs_thrown_message", T.ptr, [t]);
}

function strEq(a: Value, b: Value, ctx: Ctx): Value {
  return ctx.fn.icmp("ne", ctx.fn.call("@cs_str_eq", T.i32, [a, b]), imm(T.i32, 0));
}

// `typeof e`.
export function thrownTypeof(t: Value, ctx: Ctx): Value {
  return ctx.fn.select(
    thrownIsString(t, ctx),
    ctx.mod.cstring("string"),
    ctx.mod.cstring("object"),
  );
}

// `typeof e === test`: only "string" and "object" can hold.
export function thrownTypeIs(t: Value, test: TypeTest, ctx: Ctx): Value {
  switch (test) {
    case "string":
      return thrownIsString(t, ctx);
    case "object":
      return ctx.fn.logicalNot(thrownIsString(t, ctx));
    case "number":
    case "boolean":
    case "undefined":
    case "function":
    case "bigint":
    case "symbol":
    case "array":
      return imm(T.i1, 0);
    default: {
      const never: never = test;
      return ice(`thrownTypeIs: unhandled test ${String(never)}`);
    }
  }
}

// JS truthiness: an error is truthy, a thrown string unless it is "".
export function thrownTruthy(t: Value, ctx: Ctx): Value {
  const len = ctx.fn.call("@cs_str_len", T.i32, [thrownText(t, ctx)]);
  return ctx.fn.logicalOr(
    ctx.fn.logicalNot(thrownIsString(t, ctx)),
    ctx.fn.icmp("ne", len, imm(T.i32, 0)),
  );
}

// `Number(e)`: a thrown string parses as Number(str); an error converts through its
// "Name: message" text, which never parses, so it is NaN.
export function thrownToNumber(t: Value, ctx: Ctx): Value {
  const parsed = ctx.fn.call("@cs_string_to_number", T.double, [thrownText(t, ctx)]);
  return ctx.fn.select(thrownIsString(t, ctx), parsed, fimm(NaN));
}

// `a === b` where `a` is a caught value (or an Error) and `b` an already-evaluated value of type
// `bType`. A string equals only a thrown string with the same text; two caught values are equal
// when they are one record or two thrown strings with the same text; nothing of any other kind
// equals a string or an error.
export function thrownStrictEq(a: Value, b: Value, bType: ValueType, ctx: Ctx): Value {
  switch (bType.kind) {
    case "string":
      return ctx.fn.logicalAnd(thrownIsString(a, ctx), strEq(thrownText(a, ctx), b, ctx));
    case "unknown": {
      const bothStrings = ctx.fn.logicalAnd(thrownIsString(a, ctx), thrownIsString(b, ctx));
      const sameText = strEq(thrownText(a, ctx), thrownText(b, ctx), ctx);
      return ctx.fn.logicalOr(ctx.fn.icmp("eq", a, b), ctx.fn.logicalAnd(bothStrings, sameText));
    }
    // A union or an optional (`Error | undefined`) is compared through its string or error member.
    case "value":
    case "optional": {
      const word = bType.kind === "optional" ? boxValue(b, bType, ctx) : b;
      return switchOnValue(word, membersOf(bType), T.i1, ctx, (m) =>
        m.kind === "string" || m.kind === "unknown"
          ? thrownStrictEq(a, unboxValue(word, m, ctx), m, ctx)
          : imm(T.i1, 0),
      );
    }
    case "number":
    case "boolean":
    case "null":
    case "undefined":
    case "object":
    case "array":
    case "function":
    case "map":
    case "set":
    case "promise":
    case "opaque":
      return imm(T.i1, 0);
    default: {
      const never: never = bType;
      return ice(`thrownStrictEq: unhandled ${(never as ValueType).kind}`);
    }
  }
}
