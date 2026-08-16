// JSON.parse codegen: a type-directed walk over the parsed tree (runtime/json-parse.c), the mirror
// image of json.ts. The target shape is known at compile time, so every field name, every kind
// check, and every error path is emitted statically — the runtime never learns what it is building.
//
// The contract this enforces: a value only reaches the program if the JSON AGREED with the target
// type at every position. Anything else throws with a compile-time-known path naming where the
// disagreement was. That is what lets the rest of the compiler trust the declared type without a
// checker at runtime, and it is why `any` never enters the type domain.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { boxSlot, type Ctx } from "./expr.js";

// Mirrors the enum in runtime/json-parse.c.
const KIND = { null: 0, bool: 1, number: 2, string: 3, array: 4, object: 5 } as const;

export function jsonParse(text: Value, target: ValueType, ctx: Ctx): Value {
  const root = ctx.fn.call("@cs_json_parse", T.ptr, [text]);
  return extract(root, target, "value", ctx);
}

// Emit `if (kind(node) !== want) throw`. The failure branch is terminated `unreachable` because
// cs_json_expect_fail always throws — leaving it to fall through would let the verifier see a
// path that produces no value.
function requireKind(node: Value, want: number, path: string, expected: string, ctx: Ctx): void {
  const actual = ctx.fn.call("@cs_json_kind", T.i32, [node]);
  const ok = ctx.fn.icmp("eq", actual, imm(T.i32, want));
  const okB = ctx.fn.newBlock("json.ok");
  const failB = ctx.fn.newBlock("json.mismatch");
  ctx.fn.brCond(ok, okB, failB);
  ctx.fn.switchTo(failB);
  ctx.fn.callVoid("@cs_json_expect_fail", [ctx.mod.cstring(path), ctx.mod.cstring(expected)]);
  ctx.fn.unreachable();
  ctx.fn.switchTo(okB);
}

function extract(node: Value, type: ValueType, path: string, ctx: Ctx): Value {
  switch (type.kind) {
    case "number":
      requireKind(node, KIND.number, path, "a number", ctx);
      return ctx.fn.call("@cs_json_number_of", T.double, [node]);

    case "string":
      requireKind(node, KIND.string, path, "a string", ctx);
      return ctx.fn.call("@cs_json_string_of", T.ptr, [node]);

    case "boolean": {
      requireKind(node, KIND.bool, path, "a boolean", ctx);
      // The runtime answers 0/1 in an i32; the language's boolean is an i1.
      const raw = ctx.fn.call("@cs_json_bool_of", T.i32, [node]);
      return ctx.fn.icmp("ne", raw, imm(T.i32, 0));
    }

    case "array": {
      requireKind(node, KIND.array, path, "an array", ctx);
      const elementType = type.element;
      const arr = ctx.fn.call("@cs_array_new", T.ptr, []);
      const len = ctx.fn.call("@cs_json_array_len", T.i32, [node]);
      const iPtr = ctx.fn.alloca(T.i32);
      ctx.fn.store(imm(T.i32, 0), iPtr);

      const head = ctx.fn.newBlock("json.arr.head");
      const body = ctx.fn.newBlock("json.arr.body");
      const done = ctx.fn.newBlock("json.arr.done");
      ctx.fn.br(head);
      ctx.fn.switchTo(head);
      const i = ctx.fn.load(T.i32, iPtr);
      ctx.fn.brCond(ctx.fn.icmp("slt", i, len), body, done);

      ctx.fn.switchTo(body);
      const iNow = ctx.fn.load(T.i32, iPtr);
      const elemNode = ctx.fn.call("@cs_json_array_get", T.ptr, [node, iNow]);
      // Every element shares one compile-time path suffix: the index is a runtime value, so the
      // message names the position in the TYPE ("items[]"), not the failing index.
      const elem = extract(elemNode, elementType, `${path}[]`, ctx);
      ctx.fn.callVoid("@cs_array_push", [arr, boxSlot(elem, elementType, ctx)]);
      ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, iPtr), imm(T.i32, 1)), iPtr);
      ctx.fn.br(head);

      ctx.fn.switchTo(done);
      return arr;
    }

    case "object": {
      if (type.className !== undefined) {
        return ice("jsonParse: class instances are not a JSON target (no constructor is run)");
      }
      requireKind(node, KIND.object, path, "an object", ctx);
      const fields = type.shape.fields;
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, fields.length * 8)]);
      fields.forEach((f, idx) => {
        const fieldNode = ctx.fn.call("@cs_json_field", T.ptr, [node, ctx.mod.cstring(f.name)]);
        const value = extractField(fieldNode, f.type, `${path}.${f.name}`, ctx);
        ctx.fn.store(boxSlot(value, f.type, ctx), ctx.fn.gepSlot(rec, idx));
      });
      return rec;
    }

    default:
      return ice(`jsonParse: ${type.kind} is not a supported JSON target type`);
  }
}

// A field lookup returns null when the key is ABSENT, which is a different condition from the key
// being present with a wrong type. An optional field tolerates absence; a required one does not.
function extractField(fieldNode: Value, type: ValueType, path: string, ctx: Ctx): Value {
  if (type.kind !== "optional") {
    const present = ctx.fn.icmp("ne", ctx.fn.ptrToI64(fieldNode), imm(T.i64, 0));
    const okB = ctx.fn.newBlock("json.field.present");
    const missB = ctx.fn.newBlock("json.field.missing");
    ctx.fn.brCond(present, okB, missB);
    ctx.fn.switchTo(missB);
    ctx.fn.callVoid("@cs_json_expect_fail", [
      ctx.mod.cstring(path),
      ctx.mod.cstring("a required property"),
    ]);
    ctx.fn.unreachable();
    ctx.fn.switchTo(okB);
    return extract(fieldNode, type, path, ctx);
  }

  // `T | undefined`: absent OR JSON null both produce the undefined sentinel, matching how the
  // rest of the language represents an optional field.
  const result = ctx.fn.alloca(T.ptr);
  const absentB = ctx.fn.newBlock("json.opt.absent");
  const checkNullB = ctx.fn.newBlock("json.opt.checknull");
  const presentB = ctx.fn.newBlock("json.opt.present");
  const endB = ctx.fn.newBlock("json.opt.end");

  const present = ctx.fn.icmp("ne", ctx.fn.ptrToI64(fieldNode), imm(T.i64, 0));
  ctx.fn.brCond(present, checkNullB, absentB);

  ctx.fn.switchTo(absentB);
  ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(checkNullB);
  const kind = ctx.fn.call("@cs_json_kind", T.i32, [fieldNode]);
  ctx.fn.brCond(ctx.fn.icmp("eq", kind, imm(T.i32, KIND.null)), absentB, presentB);

  ctx.fn.switchTo(presentB);
  const inner = extract(fieldNode, type.inner, path, ctx);
  const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(boxSlot(inner, type.inner, ctx), box);
  ctx.fn.store(box, result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}
