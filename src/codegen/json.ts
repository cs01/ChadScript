// JSON.stringify codegen: a type-directed recursive walk that builds the JSON text of a value at
// runtime (mirrors inspect.ts, but with JSON rules — double-quoted keys/strings, non-finite numbers →
// `null`, class names dropped). Leaf number/string conversions are in runtime/json.c. Optional fields
// follow JSON's omit-undefined / null / value rules. An `indent` unit (from the literal `space`
// argument) turns on pretty-printing: each nesting level is prefixed with a newline + the unit
// repeated by depth. Because the unit and the depth are both known at compile time, every indent
// prefix is a compile-time string — no runtime indent arithmetic.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { unboxSlot, type Ctx } from "./expr.js";
import { headerOffset } from "./objects.js";

const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

// The line prefix at nesting `depth`: newline + the indent unit repeated `depth` times (empty string
// when compact). `indent` null means compact (no newlines, no spaces).
const linePrefix = (indent: string | null, depth: number): string =>
  indent === null ? "" : "\n" + indent.repeat(depth);

// A string Value holding the JSON text of `value` (of type `type`). `indent` is the pretty-print
// unit (null = compact); `depth` is the current nesting level (0 at the top).
export function jsonStringify(
  value: Value,
  type: ValueType,
  ctx: Ctx,
  indent: string | null,
  depth: number,
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
    case "object":
      return jsonObject(value, type, ctx, indent, depth);
    default:
      // undefined (context-dependent), map/set/function/promise: not yet.
      return ice(`JSON.stringify: unsupported value type ${type.kind}`);
  }
}

// `[]` or (compact) `[e0,e1]` or (pretty) `[\n  e0,\n  e1\n]`.
function jsonArray(
  arr: Value,
  elementType: ValueType,
  ctx: Ctx,
  indent: string | null,
  depth: number,
): Value {
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  const child = linePrefix(indent, depth + 1);
  const open = "[" + child;
  const sep = "," + child;
  const close = linePrefix(indent, depth) + "]";
  return jsonJoin(len, open, sep, close, "[]", ctx, (i) => {
    const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elementType, ctx);
    return jsonStringify(elem, elementType, ctx, indent, depth + 1);
  });
}

// `{}` or `{"k":v,...}` (compact) / `{\n  "k": v,\n  ...\n}` (pretty). Fields are static, so this
// unrolls. Optional fields: undefined omits the key, null → `null`, present → the value. Omission is
// a runtime decision, so a `wrote` flag drives both the comma and (pretty) the closing newline.
function jsonObject(
  obj: Value,
  type: Extract<ValueType, { kind: "object" }>,
  ctx: Ctx,
  indent: string | null,
  depth: number,
): Value {
  const fields = type.shape.fields;
  if (fields.length === 0) return ctx.mod.cstring("{}");
  const off = headerOffset(type);
  const child = linePrefix(indent, depth + 1); // before each key
  const colon = indent === null ? ":" : ": ";
  const closePrefix = linePrefix(indent, depth); // before the closing brace, if anything was written

  const accPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(ctx.mod.cstring("{"), accPtr);
  const wrotePtr = ctx.fn.alloca(T.i1);
  ctx.fn.store(imm(T.i1, 0), wrotePtr);
  const append = (s: Value): void =>
    ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), s), accPtr);
  // Comma before a field iff one was already written (the comma precedes the newline+indent).
  const appendComma = (): void => {
    const cB = ctx.fn.newBlock("json.comma");
    const aB = ctx.fn.newBlock("json.aftercomma");
    ctx.fn.brCond(ctx.fn.load(T.i1, wrotePtr), cB, aB);
    ctx.fn.switchTo(cB);
    append(ctx.mod.cstring(","));
    ctx.fn.br(aB);
    ctx.fn.switchTo(aB);
  };
  const emitKey = (name: string): void => append(ctx.mod.cstring(`${child}"${name}"${colon}`));

  fields.forEach((f, i) => {
    const slot = ctx.fn.gepSlot(obj, i + off);
    if (f.type.kind === "optional") {
      const inner = f.type.inner;
      const optPtr = ctx.fn.load(T.ptr, slot); // undefined/null sentinel, or a box holding the value
      const isUndef = ctx.fn.icmp("eq", optPtr, ctx.mod.externGlobal("cs_undefined_marker"));
      const emitB = ctx.fn.newBlock("json.optemit");
      const contB = ctx.fn.newBlock("json.optcont");
      ctx.fn.brCond(isUndef, contB, emitB); // undefined → omit the key
      ctx.fn.switchTo(emitB);
      appendComma();
      emitKey(f.name);
      const isNull = ctx.fn.icmp("eq", optPtr, ctx.mod.externGlobal("cs_null_marker"));
      const nullB = ctx.fn.newBlock("json.optnull");
      const valB = ctx.fn.newBlock("json.optval");
      const joinB = ctx.fn.newBlock("json.optjoin");
      const vPtr = ctx.fn.alloca(T.ptr);
      ctx.fn.brCond(isNull, nullB, valB);
      ctx.fn.switchTo(nullB);
      ctx.fn.store(ctx.mod.cstring("null"), vPtr);
      ctx.fn.br(joinB);
      ctx.fn.switchTo(valB);
      const innerVal = unboxSlot(ctx.fn.load(T.i64, optPtr), inner, ctx);
      ctx.fn.store(jsonStringify(innerVal, inner, ctx, indent, depth + 1), vPtr);
      ctx.fn.br(joinB);
      ctx.fn.switchTo(joinB);
      append(ctx.fn.load(T.ptr, vPtr));
      ctx.fn.store(imm(T.i1, 1), wrotePtr);
      ctx.fn.br(contB);
      ctx.fn.switchTo(contB);
    } else {
      appendComma();
      emitKey(f.name);
      append(
        jsonStringify(
          unboxSlot(ctx.fn.load(T.i64, slot), f.type, ctx),
          f.type,
          ctx,
          indent,
          depth + 1,
        ),
      );
      ctx.fn.store(imm(T.i1, 1), wrotePtr);
    }
  });
  // Close: `<newline+indent>}` if anything was written (pretty), else just `}` (compact, or an
  // all-optional object that emitted nothing → `{}`).
  const close = ctx.fn.select(
    ctx.fn.load(T.i1, wrotePtr),
    ctx.mod.cstring(closePrefix + "}"),
    ctx.mod.cstring("}"),
  );
  return concat(ctx, ctx.fn.load(T.ptr, accPtr), close);
}

// Build `open` + `elemStr(0)` + `sep` + `elemStr(1)` + ... + `close` over `count` elements; an empty
// container is `empty`. Recursion-safe: `elemStr` may emit its own blocks (nested containers), and
// the accumulator lives in an alloca so the current block after a nested call is irrelevant.
function jsonJoin(
  count: Value,
  open: string,
  sep: string,
  close: string,
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
  const sepB = ctx.fn.newBlock("json.sep");
  const afterSepB = ctx.fn.newBlock("json.aftersep");
  ctx.fn.brCond(ctx.fn.icmp("sgt", idx, imm(T.i32, 0)), sepB, afterSepB);
  ctx.fn.switchTo(sepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(sep)), accPtr);
  ctx.fn.br(afterSepB);
  ctx.fn.switchTo(afterSepB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), elemStr(idx)), accPtr);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(doneB);
  ctx.fn.store(concat(ctx, ctx.fn.load(T.ptr, accPtr), ctx.mod.cstring(close)), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}
