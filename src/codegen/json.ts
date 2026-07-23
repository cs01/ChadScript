// JSON.stringify codegen: a type-directed recursive walk that builds the JSON text of a value at
// runtime (mirrors inspect.ts, but with JSON rules — double-quoted keys/strings, no spaces, non-
// finite numbers → `null`, class names dropped). Leaf number/string conversions are in runtime/json.c.
// Optional/undefined values are NOT supported yet (JSON's omit-undefined-key vs null-in-array rules
// are context-dependent); they hit a loud ICE rather than silently diverging.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { unboxSlot, type Ctx } from "./expr.js";
import { headerOffset } from "./objects.js";

const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

// A string Value holding the JSON text of `value` (of type `type`).
export function jsonStringify(value: Value, type: ValueType, ctx: Ctx): Value {
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
      return jsonArray(value, type.element, ctx);
    case "object":
      return jsonObject(value, type, ctx);
    default:
      // optional/undefined (context-dependent omit vs null), map/set/function/promise: not yet.
      return ice(`JSON.stringify: unsupported value type ${type.kind}`);
  }
}

// `[]` or `[e0,e1,...]` — compact, comma-separated, no spaces.
function jsonArray(arr: Value, elementType: ValueType, ctx: Ctx): Value {
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  return jsonJoin(len, "[", "]", ctx, (i) => {
    const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elementType, ctx);
    return jsonStringify(elem, elementType, ctx);
  });
}

// `{}` or `{"k0":v0,"k1":v1}` — fields are static, so this unrolls. Field names are identifiers
// (subset), safe to emit as literal quoted keys. Class names are omitted (JSON has no class notion).
function jsonObject(obj: Value, type: Extract<ValueType, { kind: "object" }>, ctx: Ctx): Value {
  const fields = type.shape.fields;
  if (fields.length === 0) return ctx.mod.cstring("{}");
  const off = headerOffset(type);
  let acc = ctx.mod.cstring("{");
  fields.forEach((f, i) => {
    if (f.type.kind === "optional") {
      ice("JSON.stringify: objects with optional fields not supported yet");
    }
    const sep = i > 0 ? "," : "";
    acc = concat(ctx, acc, ctx.mod.cstring(`${sep}"${f.name}":`));
    const fieldVal = unboxSlot(ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, i + off)), f.type, ctx);
    acc = concat(ctx, acc, jsonStringify(fieldVal, f.type, ctx));
  });
  return concat(ctx, acc, ctx.mod.cstring("}"));
}

// Build `open` + comma-joined `elemStr(i)` for i in [0,count) + `close`. Empty → `openclose`.
// Recursion-safe: `elemStr` may itself emit blocks (nested arrays/objects), and the accumulator
// lives in an alloca so the current block after a nested call is irrelevant.
function jsonJoin(
  count: Value,
  open: string,
  close: string,
  ctx: Ctx,
  elemStr: (i: Value) => Value,
): Value {
  const accPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(ctx.mod.cstring(open), accPtr);
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
  // Separator "," before every element after the first.
  const sepB = ctx.fn.newBlock("json.sep");
  const afterSepB = ctx.fn.newBlock("json.aftersep");
  ctx.fn.brCond(ctx.fn.icmp("sgt", idx, imm(T.i32, 0)), sepB, afterSepB);
  ctx.fn.switchTo(sepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(",")), accPtr);
  ctx.fn.br(afterSepB);
  ctx.fn.switchTo(afterSepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), elemStr(idx)), accPtr);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(doneB);
  return concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(close));
}
