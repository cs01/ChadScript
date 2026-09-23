// Printers for "any JSON value" words: the values of keys a JSON.parse target type does not declare
// (runtime/json-parse.milo anyValue). No static type describes them, and one can be an array of
// arrays of objects to any depth, so they cannot be formatted by inlining a type-directed walk the
// way declared fields are. Instead two out-of-line functions switch on the word and call themselves
// for array elements; an object is formatted by its own (dynamic-template) shape, whose printers
// come back here for each field.

import { imm, type ModuleBuilder, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import { ANY_OBJECT, VT, type ValueType } from "../hir/types.js";
import type { ShapeDescriptor } from "../hir/nodes.js";
import type { Ctx } from "./expr.js";
import { inspect, inspectSlots } from "./inspect.js";
import { jsonEnter, jsonJoin, jsonStringify, linePrefix, nextDepth } from "./json.js";
import { switchOnValue } from "./value-ops.js";
import { unboxValue } from "./value.js";

const INSPECT_FN = "json.any.inspect";
const JSON_FN = "json.any.json";

// The kinds an any-JSON word holds. The array member's element type is never read: the array arm
// below formats elements by calling the any-JSON printer itself, which is what makes the recursion
// finite at compile time.
const MEMBERS: ValueType[] = [
  VT.number,
  VT.string,
  VT.boolean,
  VT.null,
  ANY_OBJECT,
  VT.array(VT.number),
];

// The util.inspect text of an any-JSON word at nesting `depth`.
export function inspectAny(raw: Value, ctx: Ctx, depth: Value): Value {
  return ctx.fn.call(`@${INSPECT_FN}`, T.ptr, [raw, depth]);
}

// The JSON text of an any-JSON word.
export function jsonAny(raw: Value, ctx: Ctx, indent: Value, depth: Value): Value {
  return ctx.fn.call(`@${JSON_FN}`, T.ptr, [raw, indent, depth]);
}

export function emitJsonAnyFunctions(
  mod: ModuleBuilder,
  shapes: readonly ShapeDescriptor[],
  fnCtx: (fn: Ctx["fn"]) => Ctx,
): void {
  if (!shapes.some((s) => s.jsonTemplate)) return;
  {
    const raw: Value = { name: "%w", type: T.i64 };
    const depth: Value = { name: "%depth", type: T.i32 };
    const fn = mod.defineFunc(INSPECT_FN, T.ptr, [raw, depth]);
    const ctx = fnCtx(fn);
    fn.ret(
      switchOnValue(raw, MEMBERS, T.ptr, ctx, (m) => {
        if (m.kind === "null") return mod.cstring("null");
        if (m.kind !== "array") return inspect(unboxValue(raw, m, ctx), m, ctx, depth);
        const arr = unboxValue(raw, m, ctx);
        return inspectSlots(arr, ctx, depth, null, (slot, inner) => inspectAny(slot, ctx, inner));
      }),
    );
  }
  {
    const raw: Value = { name: "%w", type: T.i64 };
    const indent: Value = { name: "%indent", type: T.ptr };
    const depth: Value = { name: "%depth", type: T.i32 };
    const fn = mod.defineFunc(JSON_FN, T.ptr, [raw, indent, depth]);
    const ctx = fnCtx(fn);
    fn.ret(
      switchOnValue(raw, MEMBERS, T.ptr, ctx, (m) => {
        if (m.kind === "null") return mod.cstring("null");
        if (m.kind !== "array")
          return jsonStringify(unboxValue(raw, m, ctx), m, ctx, indent, depth);
        const arr = unboxValue(raw, m, ctx);
        const len = fn.call("@cs_array_len", T.i32, [arr]);
        const inner = nextDepth(ctx, depth);
        const child = linePrefix(ctx, indent, inner);
        const concat = (a: Value, b: Value): Value => fn.call("@cs_str_concat", T.ptr, [a, b]);
        const open = concat(mod.cstring("["), child);
        const sep = concat(mod.cstring(","), child);
        const close = concat(linePrefix(ctx, indent, depth), mod.cstring("]"));
        jsonEnter(arr, "Array", ctx);
        const text = jsonJoin(len, open, sep, close, "[]", ctx, (i) => {
          fn.callVoid("@cs_json_key_index", [i]);
          return jsonAny(fn.call("@cs_array_get", T.i64, [arr, i]), ctx, indent, inner);
        });
        fn.callVoid("@cs_json_leave", []);
        return text;
      }),
    );
  }
}
