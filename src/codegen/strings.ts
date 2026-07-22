// String method codegen: `str.method(args)` → IR Value. Most methods are a single runtime call
// (STR_METHODS table); the variadic/optional-argument forms (slice/substring/substr/pad*/indexOf/
// lastIndexOf/includes/startsWith/endsWith/concat) are special-cased. The supported set is mirrored
// by the validator's string-method allowlist (CS1223); an unsupported method never reaches here.
// Split out of expr.ts; `evalString`/`evalValue` are imported back (circular, resolved at call time).

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import { type Ctx, evalString, evalValue } from "./expr.js";

type StrRet = "string" | "number" | "bool" | "array";
const STR_METHODS: Record<string, { fn: string; ret: StrRet }> = {
  toUpperCase: { fn: "@cs_str_upper", ret: "string" },
  toLowerCase: { fn: "@cs_str_lower", ret: "string" },
  trim: { fn: "@cs_str_trim", ret: "string" },
  trimStart: { fn: "@cs_str_trim_start", ret: "string" },
  trimEnd: { fn: "@cs_str_trim_end", ret: "string" },
  replaceAll: { fn: "@cs_str_replaceAll", ret: "string" },
  repeat: { fn: "@cs_str_repeat", ret: "string" },
  charAt: { fn: "@cs_str_char_at", ret: "string" },
  replace: { fn: "@cs_str_replace", ret: "string" },
  split: { fn: "@cs_str_split", ret: "array" },
  includes: { fn: "@cs_str_includes", ret: "bool" },
};

function strRetIrType(ret: StrRet) {
  return ret === "number" ? T.double : ret === "bool" ? T.i32 : T.ptr;
}

export function evalStrMethod(expr: Extract<HExpr, { kind: "strMethod" }>, ctx: Ctx): Value {
  const recv = evalString(expr.receiver, ctx);
  const args = expr.args.map((a) => evalValue(a, ctx));

  // slice has 1-or-2-arg forms with different runtime entry points (the second arg defaults to
  // the string length inside slice1).
  if (expr.method === "slice") {
    const fn = args.length >= 2 ? "@cs_str_slice2" : "@cs_str_slice1";
    return ctx.fn.call(fn, T.ptr, [recv, ...args]);
  }
  if (expr.method === "substring") {
    const fn = args.length >= 2 ? "@cs_str_substring2" : "@cs_str_substring1";
    return ctx.fn.call(fn, T.ptr, [recv, ...args]);
  }
  // substr(start, length?): length defaults to "to the end", signalled with a NaN sentinel.
  if (expr.method === "substr") {
    const len = args.length >= 2 ? args[1]! : fimm(NaN);
    return ctx.fn.call("@cs_str_substr", T.ptr, [recv, args[0]!, len]);
  }
  // padStart/padEnd: the pad string is optional and defaults to a single space.
  if (expr.method === "padStart" || expr.method === "padEnd") {
    const fn = expr.method === "padStart" ? "@cs_str_pad_start" : "@cs_str_pad_end";
    const padArg = args.length >= 2 ? args[1]! : ctx.mod.cstring(" ");
    return ctx.fn.call(fn, T.ptr, [recv, args[0]!, padArg]);
  }

  // indexOf(sub, fromIndex?): the optional second arg defaults to 0 (search from the start).
  if (expr.method === "indexOf") {
    const from = args.length >= 2 ? args[1]! : fimm(0);
    return ctx.fn.call("@cs_str_index_of", T.double, [recv, args[0]!, from]);
  }
  // lastIndexOf(sub, fromIndex?): default fromIndex is +Infinity (search the whole string).
  if (expr.method === "lastIndexOf") {
    const from = args.length >= 2 ? args[1]! : fimm(Infinity);
    return ctx.fn.call("@cs_str_last_index_of", T.double, [recv, args[0]!, from]);
  }
  // includes(sub, position?)/startsWith(p, position?) default position 0; endsWith(p, endPos?)
  // defaults endPos to the length, signalled to the runtime with a NaN sentinel. All return i32
  // 0/1 → narrow to i1.
  if (expr.method === "includes" || expr.method === "startsWith" || expr.method === "endsWith") {
    const fn =
      expr.method === "includes"
        ? "@cs_str_includes"
        : expr.method === "startsWith"
          ? "@cs_str_starts_with"
          : "@cs_str_ends_with";
    const dflt = expr.method === "endsWith" ? fimm(NaN) : fimm(0);
    const pos = args.length >= 2 ? args[1]! : dflt;
    const raw = ctx.fn.call(fn, T.i32, [recv, args[0]!, pos]);
    return ctx.fn.icmp("ne", raw, imm(T.i32, 0));
  }

  // String.prototype.concat(...args): variadic, so it doesn't fit the fixed-shape table — fold the
  // receiver and every arg left-to-right with the binary runtime concat. tsc-strict guarantees all
  // args are strings.
  if (expr.method === "concat") {
    let acc = recv;
    for (const a of args) acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, a]);
    return acc;
  }

  const m = STR_METHODS[expr.method];
  if (!m) return ice(`codegen: string method .${expr.method} not supported yet`);
  const raw = ctx.fn.call(m.fn, strRetIrType(m.ret), [recv, ...args]);
  // Predicates return i32 0/1 — narrow to i1.
  return m.ret === "bool" ? ctx.fn.icmp("ne", raw, imm(T.i32, 0)) : raw;
}
