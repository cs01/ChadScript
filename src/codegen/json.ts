// JSON.stringify codegen: a type-directed recursive walk that builds the JSON text of a value at
// runtime (mirrors inspect.ts, but with JSON rules — double-quoted keys/strings, non-finite numbers →
// `null`, class names dropped). Leaf number/string conversions are in runtime/json.milo. An OBJECT
// is serialized by its own shape's JSON function (codegen/shape-functions.ts), so a value typed
// through an interface serializes the fields it really has. An `indent` unit (from the literal
// `space` argument; a null pointer for compact output) turns on pretty-printing: each nesting
// level is prefixed with a newline + the unit repeated by depth (runtime/shape.milo cs_json_indent).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { unboxSlot, type Ctx } from "./expr.js";
import { loadShape, loadShapeWord } from "./shapes.js";
import { V_NULL, unboxValue } from "./value.js";
import { jsonValue } from "./value-ops.js";

const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

// The line prefix at nesting `depth` (an i32 Value): "" when compact, else newline + indent×depth.
export const linePrefix = (ctx: Ctx, indent: Value, depth: Value): Value =>
  ctx.fn.call("@cs_json_indent", T.ptr, [indent, depth]);

export const nextDepth = (ctx: Ctx, depth: Value): Value => ctx.fn.iadd(depth, imm(T.i32, 1));

// A string Value holding the JSON text of `value` (of type `type`). `indent` is the pretty-print
// unit (a null ptr = compact); `depth` is the current nesting level (an i32 Value, 0 at the top).
export function jsonStringify(
  value: Value,
  type: ValueType,
  ctx: Ctx,
  indent: Value,
  depth: Value,
): Value {
  switch (type.kind) {
    case "number":
      return ctx.fn.call("@cs_json_num", T.ptr, [value]);
    case "string":
      return ctx.fn.call("@cs_json_str", T.ptr, [value]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(value)]);
    case "null":
      return ctx.mod.cstring("null");
    case "array":
      return jsonArray(value, type.element, ctx, indent, depth);
    case "object": {
      const fn = loadShapeWord(loadShape(value, ctx), "json", ctx);
      return ctx.fn.callIndirect(fn, T.ptr, [value, indent, depth]);
    }
    case "value":
      return jsonValue(value, type, ctx, indent, depth);
    case "map":
    case "set":
      return ctx.mod.cstring("{}"); // no enumerable own properties
    // Only as an array element (validate/render-rules.ts keeps them out of the top level, and an
    // object field holding them is skipped before this is called): Node writes `null`.
    case "function":
    case "undefined":
      return ctx.mod.cstring("null");
    case "optional":
      return jsonOptionalElement(value, type.inner, ctx, indent, depth);
    default:
      return ice(`JSON.stringify: unsupported value type ${type.kind}`);
  }
}

// An optional array element: both nullish sentinels are `null`, else the inner value.
function jsonOptionalElement(
  opt: Value,
  inner: ValueType,
  ctx: Ctx,
  indent: Value,
  depth: Value,
): Value {
  const result = ctx.fn.alloca(T.ptr);
  const nullB = ctx.fn.newBlock("json.optnull");
  const valB = ctx.fn.newBlock("json.optval");
  const endB = ctx.fn.newBlock("json.optend");
  const nullish = ctx.fn.logicalOr(
    ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker")),
    ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker")),
  );
  ctx.fn.brCond(nullish, nullB, valB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.cstring("null"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(valB);
  const v = unboxSlot(ctx.fn.load(T.i64, opt), inner, ctx);
  ctx.fn.store(jsonStringify(v, inner, ctx, indent, depth), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// The JSON text of a present (not undefined) field Value stored with static type `type`.
export function jsonStored(
  raw: Value,
  type: ValueType,
  ctx: Ctx,
  indent: Value,
  depth: Value,
): Value {
  if (type.kind === "null") return ctx.mod.cstring("null");
  if (type.kind !== "optional")
    return jsonStringify(unboxValue(raw, type, ctx), type, ctx, indent, depth);
  // Present optional: null prints `null`; anything else is the inner value.
  const result = ctx.fn.alloca(T.ptr);
  const nullB = ctx.fn.newBlock("json.null");
  const valB = ctx.fn.newBlock("json.val");
  const endB = ctx.fn.newBlock("json.optend");
  ctx.fn.brCond(ctx.fn.icmp("eq", raw, imm(T.i64, V_NULL)), nullB, valB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.cstring("null"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(valB);
  const inner = unboxValue(raw, type.inner, ctx);
  ctx.fn.store(jsonStringify(inner, type.inner, ctx, indent, depth), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// `[]` or (compact) `[e0,e1]` or (pretty) `[\n  e0,\n  e1\n]`.
function jsonArray(
  arr: Value,
  elementType: ValueType,
  ctx: Ctx,
  indent: Value,
  depth: Value,
): Value {
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  const inner = nextDepth(ctx, depth);
  const child = linePrefix(ctx, indent, inner);
  const open = concat(ctx, ctx.mod.cstring("["), child);
  const sep = concat(ctx, ctx.mod.cstring(","), child);
  const close = concat(ctx, linePrefix(ctx, indent, depth), ctx.mod.cstring("]"));
  const track = mayHoldContainer(elementType);
  if (track) jsonEnter(arr, "Array", ctx);
  const text = jsonJoin(len, open, sep, close, "[]", ctx, (i) => {
    const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elementType, ctx);
    if (track) ctx.fn.callVoid("@cs_json_key_index", [i]);
    return jsonStringify(elem, elementType, ctx, indent, inner);
  });
  if (track) ctx.fn.callVoid("@cs_json_leave", []);
  return text;
}

// Whether a value of type `t` can be (or hold, as a union member) an object or array, the only
// things a cycle runs through. Containers of nothing else skip the cycle bookkeeping
// (runtime/json-cycle.milo): they can never be reached twice on one path.
export function mayHoldContainer(t: ValueType): boolean {
  switch (t.kind) {
    case "object":
    case "array":
      return true;
    case "optional":
      return mayHoldContainer(t.inner);
    case "value":
      return t.members.some(mayHoldContainer);
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "function":
    case "map":
    case "set":
    case "unknown":
    case "promise":
    case "opaque":
      return false;
    default: {
      const never: never = t;
      return ice(`mayHoldContainer: ${(never as ValueType).kind}`);
    }
  }
}

// Container `self` (constructor name `ctor`) starts serializing: a cycle throws here.
export function jsonEnter(self: Value, ctor: string, ctx: Ctx): void {
  ctx.fn.callVoid("@cs_json_enter", [self, ctx.mod.cstring(ctor)]);
}

// Build `open` + `elemStr(0)` + `sep` + `elemStr(1)` + ... + `close` over `count` elements; an empty
// container is `empty`. Recursion-safe: `elemStr` may emit its own blocks (nested containers), and
// the accumulator lives in an alloca so the current block after a nested call is irrelevant.
export function jsonJoin(
  count: Value,
  open: Value,
  sep: Value,
  close: Value,
  empty: string,
  ctx: Ctx,
  elemStr: (i: Value) => Value,
): Value {
  const result = ctx.fn.alloca(T.ptr);
  const emptyB = ctx.fn.newBlock("json.empty");
  const bodyB = ctx.fn.newBlock("json.body");
  const endB = ctx.fn.newBlock("json.end");
  ctx.fn.brCond(ctx.fn.icmp("eq", count, imm(T.i32, 0)), emptyB, bodyB);

  ctx.fn.switchTo(emptyB);
  ctx.fn.store(ctx.mod.cstring(empty), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(bodyB);
  const accPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(open, accPtr);
  const idxPtr = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, 0), idxPtr);
  const headerB = ctx.fn.newBlock("json.header");
  const iterB = ctx.fn.newBlock("json.iter");
  const doneB = ctx.fn.newBlock("json.done");
  ctx.fn.br(headerB);

  ctx.fn.switchTo(headerB);
  const i = ctx.fn.load(T.i32, idxPtr);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, count), iterB, doneB);

  ctx.fn.switchTo(iterB);
  const idx = ctx.fn.load(T.i32, idxPtr);
  const sepB = ctx.fn.newBlock("json.sep");
  const afterSepB = ctx.fn.newBlock("json.aftersep");
  ctx.fn.brCond(ctx.fn.icmp("sgt", idx, imm(T.i32, 0)), sepB, afterSepB);
  ctx.fn.switchTo(sepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), sep), accPtr);
  ctx.fn.br(afterSepB);
  ctx.fn.switchTo(afterSepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), elemStr(idx)), accPtr);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(doneB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), close), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}
