// JSON.parse codegen: a type-directed walk over the parsed tree (runtime/json-parse.milo), the mirror
// image of json.ts. The target shape is known at compile time, so every field name, every kind
// check, and every error path is emitted statically; the runtime only lays out the validated
// values in the text's key order (cs_json_object).
//
// The contract this enforces: a value only reaches the program if the JSON AGREED with the target
// type at every position. Anything else throws with a compile-time-known path naming where the
// disagreement was. That is what lets the rest of the compiler trust the declared type without a
// checker at runtime, and it is why `any` never enters the type domain.
//
// Objects are built the way Node builds them: keys in JSON text order (a duplicate key keeps its
// first position and its last value), an absent optional key does not exist on the object. The
// record's shape is therefore chosen at run time (cs_json_object, from the type's template shape),
// and every access to these types goes through an inline cache (lower/layouts.ts). A key the type
// does not declare is kept, as Node keeps it: its value becomes a plain Value word (any JSON value,
// nested objects laid out by the dynamic template), so printing, Object.keys and JSON.stringify show
// it (codegen/json-any.ts) while the program cannot name it (tsc rejects the read).

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import type { JsonObjectTarget } from "../hir/nodes.js";
import { boxSlot, type Ctx } from "./expr.js";
import { shapeGlobalName, shapeRef } from "./shapes.js";
import { boxValue, V_NULL, V_UNDEFINED } from "./value.js";
import { allocSlots, slotMayPoint } from "./alloc.js";

// Mirrors the enum in runtime/json-parse.milo.
const KIND = { null: 0, bool: 1, number: 2, string: 3, array: 4, object: 5 } as const;

type ObjectShapes = readonly JsonObjectTarget[];

export function jsonParse(
  text: Value,
  target: ValueType,
  shapes: ObjectShapes,
  dynamicShape: number,
  ctx: Ctx,
): Value {
  const root = ctx.fn.call("@cs_json_parse", T.ptr, [text]);
  return extract(root, target, "value", { shapes, dynamicShape }, ctx);
}

// The object layouts a parse can build: one template per declared object type, plus the dynamic
// template (no declared fields) that objects under undeclared keys are laid out with.
interface Targets {
  shapes: ObjectShapes;
  dynamicShape: number;
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

function extract(node: Value, type: ValueType, path: string, targets: Targets, ctx: Ctx): Value {
  const shapes = targets.shapes;
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
      const elem = extract(elemNode, elementType, `${path}[]`, targets, ctx);
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
      const target =
        shapes.find((s) => s.type === type) ??
        ice("jsonParse: an object type in the target has no registered shape");
      // Every declared field is validated (and its Value built) before the record exists, into a
      // scratch array in declared order; cs_json_object then lays out the keys the text has.
      const vals = allocSlots(
        fields.map((f) => slotMayPoint(f.type)),
        ctx,
      );
      fields.forEach((f, i) => {
        const fieldNode = ctx.fn.call("@cs_json_field", T.ptr, [node, ctx.mod.cstring(f.name)]);
        const presence = target.presence[i] ?? ice("jsonParse: field without presence info");
        const v = extractField(fieldNode, f.type, presence, `${path}.${f.name}`, targets, ctx);
        ctx.fn.store(v, ctx.fn.gepSlot(vals, i));
      });
      const cache = ctx.mod.defineZeroWords(`${shapeGlobalName(target.shape)}.jsoncache`, 1);
      return ctx.fn.call("@cs_json_object", T.ptr, [
        node,
        shapeRef(ctx, target.shape),
        cache,
        vals,
        ctx.mod.cstring(path),
        shapeRef(ctx, targets.dynamicShape),
        ctx.mod.defineZeroWords(`${shapeGlobalName(targets.dynamicShape)}.jsoncache`, 1),
      ]);
    }

    case "value":
      return extractUnion(node, type.members, path, targets, ctx);

    default:
      return ice(`jsonParse: ${type.kind} is not a supported JSON target type`);
  }
}

// A Value union target (`number | string`, `boolean | number[] | null`): the JSON value's own kind
// picks the member, which is extracted and boxed; a kind no member has is a mismatch. An object
// member is rejected by the validator (the union keeps no object layout to extract into).
function extractUnion(
  node: Value,
  members: readonly ValueType[],
  path: string,
  targets: Targets,
  ctx: Ctx,
): Value {
  const jsonKind = (m: ValueType): number | null => {
    switch (m.kind) {
      case "number":
        return KIND.number;
      case "string":
        return KIND.string;
      case "boolean":
        return KIND.bool;
      case "null":
        return KIND.null;
      case "array":
        return KIND.array;
      case "undefined":
        return null; // an absent key, handled by extractField
      default:
        return ice(`jsonParse: a ${m.kind} member of a union target`);
    }
  };
  const kind = ctx.fn.call("@cs_json_kind", T.i32, [node]);
  const result = ctx.fn.alloca(T.i64);
  const endB = ctx.fn.newBlock("json.union.end");
  const names: string[] = [];
  for (const m of members) {
    const want = jsonKind(m);
    if (want === null) continue;
    names.push(m.kind === "array" ? "an array" : m.kind === "null" ? "null" : `a ${m.kind}`);
    const hitB = ctx.fn.newBlock("json.union.member");
    const nextB = ctx.fn.newBlock("json.union.next");
    ctx.fn.brCond(ctx.fn.icmp("eq", kind, imm(T.i32, want)), hitB, nextB);
    ctx.fn.switchTo(hitB);
    const word =
      m.kind === "null"
        ? imm(T.i64, V_NULL)
        : boxValue(extract(node, m, path, targets, ctx), m, ctx);
    ctx.fn.store(word, result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(nextB);
  }
  ctx.fn.callVoid("@cs_json_expect_fail", [
    ctx.mod.cstring(path),
    ctx.mod.cstring(names.join(" or ")),
  ]);
  ctx.fn.unreachable();
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.i64, result);
}

// The record Value of one declared field. A lookup returns null when the key is ABSENT, which is a
// different condition from the key being present with a wrong type: absence is fine only where the
// type admits it (its Value is then never stored, since the key is not laid out), and JSON `null`
// only where the type includes null. Otherwise null goes to the inner extraction and fails its kind
// check, because Node would hand the program a null its declared type says cannot be there.
function extractField(
  fieldNode: Value,
  type: ValueType,
  presence: JsonObjectTarget["presence"][number],
  path: string,
  targets: Targets,
  ctx: Ctx,
): Value {
  const inner = type.kind === "optional" ? type.inner : type;
  // A Value union field carries its own undefined/null members, so it may admit both too.
  if (
    (presence.absentOk || presence.nullable) &&
    type.kind !== "optional" &&
    type.kind !== "value"
  ) {
    return ice(`jsonParse: ${path} admits null/undefined but its type is not optional`);
  }
  const result = ctx.fn.alloca(T.i64);
  const absentB = ctx.fn.newBlock("json.field.absent");
  const presentB = ctx.fn.newBlock("json.field.present");
  const endB = ctx.fn.newBlock("json.field.end");
  const present = ctx.fn.icmp("ne", ctx.fn.ptrToI64(fieldNode), imm(T.i64, 0));
  ctx.fn.brCond(present, presentB, absentB);

  ctx.fn.switchTo(absentB);
  if (presence.absentOk) {
    ctx.fn.store(imm(T.i64, V_UNDEFINED), result);
    ctx.fn.br(endB);
  } else {
    ctx.fn.callVoid("@cs_json_expect_fail", [
      ctx.mod.cstring(path),
      ctx.mod.cstring("a required property"),
    ]);
    ctx.fn.unreachable();
  }

  ctx.fn.switchTo(presentB);
  if (presence.nullable) {
    const nullB = ctx.fn.newBlock("json.field.null");
    const valueB = ctx.fn.newBlock("json.field.value");
    const kind = ctx.fn.call("@cs_json_kind", T.i32, [fieldNode]);
    ctx.fn.brCond(ctx.fn.icmp("eq", kind, imm(T.i32, KIND.null)), nullB, valueB);
    ctx.fn.switchTo(nullB);
    ctx.fn.store(imm(T.i64, V_NULL), result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(valueB);
  }
  const value = extract(fieldNode, inner, path, targets, ctx);
  ctx.fn.store(boxValue(value, inner, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.i64, result);
}
