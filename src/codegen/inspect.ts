// util.inspect formatting for console.log of a non-scalar value (array/object/map/set) and its
// nested contents. Node prints containers with a specific layout — `[ 1, 2 ]`, `{ x: 1 }`,
// `Map(1) { 'k' => 2 }` — and quotes strings only when they are NESTED inside a container (a
// top-level string prints raw). This module builds that string at runtime from the value + its
// resolved ValueType (the type tells us how to format, recursively).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { unboxSlot, type Ctx } from "./expr.js";
import { headerOffset } from "./objects.js";

// A string Value for the inspect form of `value` (of type `type`). Strings are quoted here (the
// nested context); the top-level raw-string case is handled by the caller.
export function inspect(value: Value, type: ValueType, ctx: Ctx): Value {
  switch (type.kind) {
    case "number":
      return ctx.fn.call("@cs_inspect_num", T.ptr, [value]);
    case "string":
      return ctx.fn.call("@cs_inspect_str", T.ptr, [value]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(value)]);
    case "null":
      return ctx.mod.cstring("null");
    case "undefined":
      return ctx.mod.cstring("undefined");
    case "optional":
      return inspectOptional(value, type.inner, ctx);
    case "array":
      return inspectArray(value, type.element, ctx);
    case "object":
      return inspectObject(value, type, ctx);
    case "map":
      return inspectMap(value, type.key, type.value, ctx);
    case "set":
      return inspectSet(value, type.element, ctx);
    default:
      return ice(`inspect: cannot format ${type.kind}`);
  }
}

const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

// An optional prints as its inner value, or the bare word for the nullish sentinels.
function inspectOptional(value: Value, inner: ValueType, ctx: Ctx): Value {
  const isUndef = ctx.fn.icmp("eq", value, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", value, ctx.mod.externGlobal("cs_null_marker"));
  const result = ctx.fn.alloca(T.ptr);
  const undefB = ctx.fn.newBlock("insp.undef");
  const notUndefB = ctx.fn.newBlock("insp.notundef");
  const nullB = ctx.fn.newBlock("insp.null");
  const valB = ctx.fn.newBlock("insp.val");
  const endB = ctx.fn.newBlock("insp.end");

  ctx.fn.brCond(isUndef, undefB, notUndefB);
  ctx.fn.switchTo(undefB);
  ctx.fn.store(ctx.mod.cstring("undefined"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(isNull, nullB, valB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.cstring("null"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(valB);
  const innerVal = unboxSlot(ctx.fn.load(T.i64, value), inner, ctx);
  ctx.fn.store(inspect(innerVal, inner, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// `[]` when empty, else `[ e0, e1, ... ]`. Shared loop shape with map/set below.
function inspectArray(arr: Value, elementType: ValueType, ctx: Ctx): Value {
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  return joinBracketed(len, "[", "]", ctx, (i) => {
    const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elementType, ctx);
    return inspect(elem, elementType, ctx);
  });
}

// `{}` when no fields, else `{ k0: v0, k1: v1 }` (class instances are prefixed with the class
// name, matching Node). Fields are static, so this unrolls rather than loops.
function inspectObject(obj: Value, type: Extract<ValueType, { kind: "object" }>, ctx: Ctx): Value {
  const fields = type.shape.fields;
  const prefix = type.className !== undefined ? `${type.className} ` : "";
  if (fields.length === 0) return ctx.mod.cstring(`${prefix}{}`);
  const off = headerOffset(type);
  let acc = ctx.mod.cstring(`${prefix}{ `);
  fields.forEach((f, i) => {
    if (i > 0) acc = concat(ctx, acc, ctx.mod.cstring(", "));
    acc = concat(ctx, acc, ctx.mod.cstring(`${f.name}: `));
    const fieldVal = unboxSlot(ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, i + off)), f.type, ctx);
    acc = concat(ctx, acc, inspect(fieldVal, f.type, ctx));
  });
  return concat(ctx, acc, ctx.mod.cstring(" }"));
}

// `Set(N) {}` / `Set(N) { e0, e1 }`.
function inspectSet(set: Value, element: ValueType, ctx: Ctx): Value {
  const arr = ctx.fn.call("@cs_set_values", T.ptr, [set]);
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  const body = joinBracketed(len, "{", "}", ctx, (i) => {
    const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), element, ctx);
    return inspect(elem, element, ctx);
  });
  return concat(ctx, sizePrefix("Set", len, ctx), body);
}

// `Map(N) {}` / `Map(N) { k0 => v0 }`.
function inspectMap(map: Value, keyType: ValueType, valueType: ValueType, ctx: Ctx): Value {
  const keys = ctx.fn.call("@cs_map_keys", T.ptr, [map]);
  const vals = ctx.fn.call("@cs_map_values", T.ptr, [map]);
  const len = ctx.fn.call("@cs_array_len", T.i32, [keys]);
  const body = joinBracketed(len, "{", "}", ctx, (i) => {
    const k = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [keys, i]), keyType, ctx);
    const v = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [vals, i]), valueType, ctx);
    return concat(
      ctx,
      concat(ctx, inspect(k, keyType, ctx), ctx.mod.cstring(" => ")),
      inspect(v, valueType, ctx),
    );
  });
  return concat(ctx, sizePrefix("Map", len, ctx), body);
}

// `Kind(N) ` prefix for Map/Set (the count then a space).
function sizePrefix(kind: string, len: Value, ctx: Ctx): Value {
  const n = ctx.fn.call("@cs_num_to_string", T.ptr, [ctx.fn.sitofp(len)]);
  return concat(ctx, concat(ctx, ctx.mod.cstring(`${kind}(`), n), ctx.mod.cstring(") "));
}

// Build `open` + (empty ? "" : " e0, e1 " ) + `close` over `count` elements, calling `elemStr(i)`
// for each. Empty → `openclose` with no interior spaces (Node: `[]`, `{}`).
function joinBracketed(
  count: Value,
  open: string,
  close: string,
  ctx: Ctx,
  elemStr: (i: Value) => Value,
): Value {
  const result = ctx.fn.alloca(T.ptr);
  const emptyB = ctx.fn.newBlock("join.empty");
  const bodyB = ctx.fn.newBlock("join.body");
  const endB = ctx.fn.newBlock("join.end");
  ctx.fn.brCond(ctx.fn.icmp("eq", count, imm(T.i32, 0)), emptyB, bodyB);

  ctx.fn.switchTo(emptyB);
  ctx.fn.store(ctx.mod.cstring(open + close), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(bodyB);
  const accPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(ctx.mod.cstring(open + " "), accPtr);
  const idxPtr = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, 0), idxPtr);
  const headerB = ctx.fn.newBlock("join.header");
  const iterB = ctx.fn.newBlock("join.iter");
  const doneB = ctx.fn.newBlock("join.done");
  ctx.fn.br(headerB);

  ctx.fn.switchTo(headerB);
  const i = ctx.fn.load(T.i32, idxPtr);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, count), iterB, doneB);

  ctx.fn.switchTo(iterB);
  const idx = ctx.fn.load(T.i32, idxPtr);
  // Separator ", " before every element after the first.
  const sepB = ctx.fn.newBlock("join.sep");
  const afterSepB = ctx.fn.newBlock("join.aftersep");
  ctx.fn.brCond(ctx.fn.icmp("sgt", idx, imm(T.i32, 0)), sepB, afterSepB);
  ctx.fn.switchTo(sepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(", ")), accPtr);
  ctx.fn.br(afterSepB);
  ctx.fn.switchTo(afterSepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), elemStr(idx)), accPtr);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(doneB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(" " + close)), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}
