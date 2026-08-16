// Lowering for the AMBIENT environment: the global builtins declared in stdlib/globals.d.ts
// (parseInt, parseFloat, String/Number/Boolean conversions, setTimeout), plus the one list both
// call-lowering paths consult to tell a non-user-function call from a user one.
//
// Split out of lower.ts to keep that file under the size ratchet (tests/unit/file-size.test.ts)
// and to sit alongside node-fs.ts / node-path.ts, which lower the module-imported half of the
// same surface.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf } from "./lower.js";
import { lowerNodeFsCall } from "./node-fs.js";
import { lowerNodePathCall } from "./node-path.js";
import { lowerNodeFsPromisesCall } from "./node-fs-promises.js";

// A bare-identifier call to a global builtin (parseInt/parseFloat). Returns null if `name` is
// not a recognized builtin, so the caller falls back to user-function / closure handling. These
// come from the default lib's type signatures; the runtime backs them in C.
export function lowerGlobalBuiltin(
  name: string,
  call: ts.CallExpression,
  ctx: LowerCtx,
): HExpr | null {
  if (name === "parseInt") {
    const radix = call.arguments[1];
    return {
      kind: "runtimeCall",
      fn: "cs_parse_int",
      // radix omitted → 0 sentinel (the runtime reads 0 as "default 10 with 0x auto-detect").
      args: [lowerExpr(call.arguments[0]!, ctx), radix ? lowerExpr(radix, ctx) : numLit(0)],
      type: VT.number,
    };
  }
  if (name === "parseFloat") {
    return {
      kind: "runtimeCall",
      fn: "cs_parse_float",
      args: [lowerExpr(call.arguments[0]!, ctx)],
      type: VT.number,
    };
  }
  // `setTimeout(cb, ms)` → schedule the closure. Resolved by SYMBOL (unlike the name-keyed
  // builtins above) so a user function named setTimeout stays a user function. The callback
  // lowers to an ordinary closure record; runtime/timer.c calls it as fn(env).
  if (name === "setTimeout" && isAmbientGlobal(call.expression, ctx)) {
    const cb = call.arguments[0];
    const ms = call.arguments[1];
    if (!cb || !ms) ice("lower: setTimeout requires a callback and a delay");
    return {
      kind: "runtimeCall",
      fn: "cs_set_timeout",
      args: [lowerExpr(cb, ctx), lowerExpr(ms, ctx)],
      type: VT.opaque("Timeout"),
    };
  }
  // `clearTimeout(handle)` — cancels a pending timer. The handle is opaque, so the only thing the
  // program could have done with it is hold it and pass it back here.
  if (name === "clearTimeout" && isAmbientGlobal(call.expression, ctx)) {
    const handle = call.arguments[0];
    if (!handle) ice("lower: clearTimeout requires a handle");
    return {
      kind: "runtimeCall",
      fn: "cs_clear_timeout",
      args: [lowerExpr(handle, ctx)],
      type: VT.undefined,
    };
  }
  if (name === "String" || name === "Number" || name === "Boolean") {
    const arg = call.arguments[0];
    if (!arg) ice(`lower: ${name}() with no argument not supported`);
    const resultType = name === "String" ? VT.string : name === "Number" ? VT.number : VT.boolean;
    return { kind: "convert", op: name, value: lowerExpr(arg, ctx), type: resultType };
  }
  return null;
}

// A synthetic number literal HExpr (for builtin default arguments).
function numLit(value: number): HExpr {
  return { kind: "numberLit", value, type: VT.number };
}

// Whether `node` resolves to a declaration in stdlib/globals.d.ts — the ambient environment.
// Name-keyed dispatch cannot tell an ambient global from a user function that shadows it.
function isAmbientGlobal(node: ts.Node, ctx: LowerCtx): boolean {
  const decl = symbolOf(node, ctx)?.declarations?.[0];
  return decl !== undefined && decl.getSourceFile().fileName.endsWith("stdlib/globals.d.ts");
}

// The calls that are NOT user functions: ambient globals (parseInt/String/setTimeout) and the
// `node:fs`/`node:path` module entries. Both call-lowering paths — expression position here and
// statement position in statements.ts — must consult this same list, or a construct works as an
// expression and silently lowers to a call to a nonexistent user function as a statement. That
// bug shipped once (setTimeout emitted `@setTimeout.0`); statement-position fixtures now pin it.
export function lowerInterceptedCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  if (!ts.isIdentifier(call.expression)) return null;
  return (
    lowerGlobalBuiltin(call.expression.text, call, ctx) ??
    lowerNodeFsCall(call, ctx) ??
    lowerNodeFsPromisesCall(call, ctx) ??
    lowerNodePathCall(call, ctx)
  );
}
