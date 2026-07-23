// console.log emission. Node formats each argument by its type: scalars print directly, containers
// go through util.inspect form (inspect.ts), and an optional branches on its sentinel at runtime
// because "undefined"/"null" are values a slot can hold, not types the backend can see statically.
// Split out of codegen.ts.

import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import type { Value } from "../ir/builder.js";
import { type Ctx, evalValue } from "./expr.js";
import { evalOptionalPtr, unboxOptionalValue } from "./optional.js";
import { inspect } from "./inspect.js";

// Print one value with no separator or newline. Optionals branch on the sentinel; other types
// evaluate and print directly.
export function emitPrintValue(v: HExpr, ctx: Ctx): void {
  if (v.type.kind === "optional") {
    emitPrintOptional(v, ctx);
    return;
  }
  // Bare `undefined` / `null` literals print their word.
  if (v.type.kind === "undefined" || v.type.kind === "null") {
    ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring(v.type.kind)]);
    return;
  }
  emitPrintComputed(evalValue(v, ctx), v.type, ctx);
}

// Print an already-computed Value of a printable scalar type.
export function emitPrintComputed(val: Value, type: ValueType, ctx: Ctx): void {
  switch (type.kind) {
    case "number":
      ctx.fn.callVoid("@cs_print_f64", [val]);
      return;
    case "string":
      ctx.fn.callVoid("@cs_print_cstr", [val]);
      return;
    case "boolean":
      ctx.fn.callVoid("@cs_print_bool", [ctx.fn.zextI1ToI32(val)]);
      return;
    case "array":
    case "object":
    case "map":
    case "set":
      // Containers print in util.inspect form; strings inside get quoted.
      ctx.fn.callVoid("@cs_print_cstr", [inspect(val, type, ctx)]);
      return;
    default:
      ice(`codegen: console.log of ${type.kind} not supported yet`);
  }
}

// console.log of an optional: "undefined" for the sentinel, else the unboxed inner value.
function emitPrintOptional(v: HExpr, ctx: Ctx): void {
  if (v.type.kind !== "optional") ice("emitPrintOptional: not optional");
  const inner = v.type.inner;
  const opt = evalOptionalPtr(v, ctx);
  const isUndef = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker"));
  const undefB = ctx.fn.newBlock("print.undef");
  const notUndefB = ctx.fn.newBlock("print.notundef");
  const nullB = ctx.fn.newBlock("print.null");
  const valB = ctx.fn.newBlock("print.val");
  const endB = ctx.fn.newBlock("print.end");
  ctx.fn.brCond(isUndef, undefB, notUndefB);

  ctx.fn.switchTo(undefB);
  ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring("undefined")]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(isNull, nullB, valB);

  ctx.fn.switchTo(nullB);
  ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring("null")]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(valB);
  emitPrintComputed(unboxOptionalValue(opt, inner, ctx), inner, ctx);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
}
