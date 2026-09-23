// Codegen for Value-union expressions (ValueType `value`, one self-describing i64 word; the encoding
// is in value.ts). Two halves:
//
//   - evalValueWord: produce the word for a value-typed HExpr.
//   - the operations JS defines on any value (print, inspect, String(), truthiness, typeof, ===,
//     JSON), each a branch on the word's runtime kind with one arm per union member. The member
//     supplies what the tag cannot (an array's element type), and a union that cannot hold a kind
//     gets no arm for it, so a narrow union costs only the tests it needs.
//
// A word whose kind matches no member means a TypeScript soundness hole reached run time; the
// fallthrough calls cs_value_mismatch rather than guessing.

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T, type IrType } from "../ir/types.js";
import type { HExpr, TypeTest } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  type Ctx,
  evalValue,
  evalCall,
  evalCallClosure,
  evalVirtualCall,
  evalConditional,
  evalArrayPtr,
  irTypeOf,
  lookupVar,
} from "./expr.js";
import { evalLogical } from "./truthiness.js";
import { evalMemberGet, evalObjectPtr, loadField } from "./objects.js";
import { loadShape, shapeRef } from "./shapes.js";
import { evalOptionalPtr, isNullishPtr, unboxOptionalValue } from "./optional.js";
import { evalNumber } from "./numbers.js";
import { evalAwait } from "./async.js";
import { emitPrintComputed } from "./emit-print.js";
import { inspect } from "./inspect.js";
import { jsonStringify } from "./json.js";
import { TAG, V_NULL, V_TRUE, V_UNDEFINED, evalBoxed, unboxValue } from "./value.js";

const DOUBLE_OFFSET = "562949953421312"; // 2^49, value.ts

// The Value word of a value-typed expression.
export function evalValueWord(expr: HExpr, ctx: Ctx): Value {
  if (expr.type.kind !== "value") return ice(`evalValueWord: ${expr.type.kind} expression`);
  switch (expr.kind) {
    case "box":
      return evalBox(expr, ctx);
    case "varRef":
      return ctx.fn.load(T.i64, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);
    case "virtualCall":
      return evalVirtualCall(expr, ctx);
    case "conditional":
      return evalConditional(expr, ctx);
    case "logical":
      return evalLogical(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "optionalMember": {
      // `o?.f` with a Value result: undefined when `o` is nullish, else the field's word itself.
      const objType = expr.object.type;
      if (objType.kind !== "optional") return ice("optionalMember on a non-optional receiver");
      const opt = evalOptionalPtr(expr.object, ctx);
      const result = ctx.fn.alloca(T.i64);
      const absentB = ctx.fn.newBlock("voptm.absent");
      const presentB = ctx.fn.newBlock("voptm.present");
      const endB = ctx.fn.newBlock("voptm.end");
      ctx.fn.brCond(isNullishPtr(opt, ctx), absentB, presentB);
      ctx.fn.switchTo(absentB);
      ctx.fn.store(imm(T.i64, V_UNDEFINED), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(presentB);
      const obj = unboxOptionalValue(opt, objType.inner, ctx);
      ctx.fn.store(loadField(obj, expr.access, ctx), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(endB);
      return ctx.fn.load(T.i64, result);
    }
    case "coalesce":
      return evalValueCoalesce(expr, ctx);
    case "await":
      return evalAwait(expr, ctx);
    default:
      return ice(`evalValueWord: unhandled Value expression ${expr.kind}`);
  }
}

function evalBox(expr: Extract<HExpr, { kind: "box" }>, ctx: Ctx): Value {
  const src = expr.value;
  // `arr[i]` on a Value array: the element slot already IS a Value, so read it straight out on the
  // in-range path instead of building the optional box that `index` would allocate.
  if (src.kind === "index" && src.elementType.kind === "value") {
    const arr = evalArrayPtr(src.array, ctx);
    const i = ctx.fn.fptosi_i32(evalNumber(src.index, ctx));
    const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
    const result = ctx.fn.alloca(T.i64);
    const checkB = ctx.fn.newBlock("vidx.check");
    const inB = ctx.fn.newBlock("vidx.in");
    const outB = ctx.fn.newBlock("vidx.out");
    const endB = ctx.fn.newBlock("vidx.end");
    ctx.fn.brCond(ctx.fn.icmp("sge", i, imm(T.i32, 0)), checkB, outB);
    ctx.fn.switchTo(checkB);
    ctx.fn.brCond(ctx.fn.icmp("slt", i, len), inB, outB);
    ctx.fn.switchTo(inB);
    ctx.fn.store(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(outB);
    ctx.fn.store(imm(T.i64, V_UNDEFINED), result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(endB);
    return ctx.fn.load(T.i64, result);
  }
  return evalBoxed(src, ctx);
}

// `a ?? b` with a Value left operand: `b` (in the result's representation, see lower) when the word
// is undefined (0) or null (1), else the word read at the result type. The result is usually the
// union itself; it is concrete when tsc knows the left is nullish-or-one-kind.
export function evalValueCoalesce(expr: Extract<HExpr, { kind: "coalesce" }>, ctx: Ctx): Value {
  if (expr.left.type.kind !== "value") return ice("value coalesce: left is not a Value");
  const left = evalValueWord(expr.left, ctx);
  const irt = irTypeOf(expr.type);
  const result = ctx.fn.alloca(irt);
  const defB = ctx.fn.newBlock("vnn.default");
  const presentB = ctx.fn.newBlock("vnn.present");
  const endB = ctx.fn.newBlock("vnn.end");
  ctx.fn.brCond(ctx.fn.icmp("ule", left, imm(T.i64, V_NULL)), defB, presentB);
  ctx.fn.switchTo(defB);
  ctx.fn.store(evalValue(expr.right, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(presentB);
  ctx.fn.store(unboxValue(left, expr.type, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(irt, result);
}

// `unbox`: the Value word read at the concrete type tsc narrowed it to.
export function evalUnbox(expr: Extract<HExpr, { kind: "unbox" }>, ctx: Ctx): Value {
  return unboxValue(evalValueWord(expr.value, ctx), expr.type, ctx);
}

// The members a word of static type `t` can hold, for dispatch. A Value union lists them; an
// optional holds its inner value or a nullish word; anything else is exactly itself.
export function membersOf(t: ValueType): ValueType[] {
  if (t.kind === "value") return t.members;
  if (t.kind === "optional") return [t.inner, { kind: "undefined" }, { kind: "null" }];
  return [t];
}

// Branch on the kind `raw` holds: one block per member, each running `arm(member)` and storing its
// result (of IR type `resultType`) into the returned slot's value. A single member needs no test.
export function switchOnValue(
  raw: Value,
  members: readonly ValueType[],
  resultType: IrType,
  ctx: Ctx,
  arm: (m: ValueType) => Value,
): Value {
  if (members.length === 1) return arm(members[0]!);
  const result = ctx.fn.alloca(resultType);
  const endB = ctx.fn.newBlock("vsw.end");
  const has = (k: ValueType["kind"]): ValueType | undefined => members.find((m) => m.kind === k);
  const test = (cond: Value, m: ValueType): void => {
    const armB = ctx.fn.newBlock(`vsw.${m.kind}`);
    const nextB = ctx.fn.newBlock("vsw.next");
    ctx.fn.brCond(cond, armB, nextB);
    ctx.fn.switchTo(armB);
    ctx.fn.store(arm(m), result);
    ctx.fn.br(endB);
    ctx.fn.switchTo(nextB);
  };
  // Order matters: numbers are every word >= 2^49, and the immediates (0..3) must be excluded
  // before the low-bit tag test, because `0` (undefined) carries tag bits 0 like an object pointer.
  const num = has("number");
  if (num) test(ctx.fn.icmp("uge", raw, imm(T.i64, DOUBLE_OFFSET)), num);
  const undef = has("undefined");
  if (undef) test(ctx.fn.icmp("eq", raw, imm(T.i64, V_UNDEFINED)), undef);
  const nul = has("null");
  if (nul) test(ctx.fn.icmp("eq", raw, imm(T.i64, V_NULL)), nul);
  const bool = has("boolean");
  if (bool) test(ctx.fn.icmp("ule", raw, imm(T.i64, V_TRUE)), bool);
  const pointers = members.filter((m) => pointerTagOf(m) !== null);
  if (pointers.length > 0) {
    const tag = ctx.fn.land(raw, imm(T.i64, 7));
    for (const m of pointers) test(ctx.fn.icmp("eq", tag, imm(T.i64, pointerTagOf(m)!)), m);
  }
  ctx.fn.callVoid("@cs_value_mismatch", []);
  ctx.fn.unreachable();
  ctx.fn.switchTo(endB);
  return ctx.fn.load(resultType, result);
}

function pointerTagOf(m: ValueType): number | null {
  switch (m.kind) {
    case "object":
      return TAG.object;
    case "string":
      return TAG.string;
    case "array":
      return TAG.array;
    case "function":
      return TAG.function;
    case "map":
      return TAG.map;
    case "set":
      return TAG.set;
    // Only as the one present member of an optional (`Error | undefined`, `Promise<T> | undefined`):
    // the union builder rejects them beside other kinds (type-translation.ts valueUnion).
    case "promise":
      return TAG.promise;
    case "unknown":
    case "opaque":
      return TAG.other;
    case "number":
    case "boolean":
    case "null":
    case "undefined":
      return null;
    default:
      return ice(`Value member of kind ${m.kind}`);
  }
}

// console.log of a top-level Value: a string prints raw, everything else as Node formats it.
export function printValue(raw: Value, t: ValueType, ctx: Ctx): void {
  switchOnValue(raw, membersOf(t), T.i1, ctx, (m) => {
    if (m.kind === "undefined" || m.kind === "null") {
      ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring(m.kind)]);
    } else {
      emitPrintComputed(unboxValue(raw, m, ctx), m, ctx);
    }
    return imm(T.i1, 0);
  });
}

// util.inspect form of a nested Value (strings quoted).
export function inspectValue(raw: Value, t: ValueType, ctx: Ctx, depth: Value): Value {
  return switchOnValue(raw, membersOf(t), T.ptr, ctx, (m) =>
    m.kind === "undefined" || m.kind === "null"
      ? ctx.mod.cstring(m.kind)
      : inspect(unboxValue(raw, m, ctx), m, ctx, depth),
  );
}

// `String(x)` / template interpolation of a Value. The validator admits it only for unions of
// primitives and nullish members (an object's String() would call its toString).
export function valueToString(raw: Value, t: ValueType, ctx: Ctx): Value {
  return switchOnValue(raw, membersOf(t), T.ptr, ctx, (m) => {
    switch (m.kind) {
      case "number":
        return ctx.fn.call("@cs_num_to_string", T.ptr, [unboxValue(raw, m, ctx)]);
      case "string":
        return unboxValue(raw, m, ctx);
      case "boolean":
        return ctx.fn.call("@cs_bool_to_string", T.ptr, [
          ctx.fn.zextI1ToI32(unboxValue(raw, m, ctx)),
        ]);
      case "undefined":
      case "null":
        return ctx.mod.cstring(m.kind);
      default:
        return ice(`String() of a Value holding a ${m.kind}`);
    }
  });
}

// An element's text in `arr.join()`: like String(x), except that undefined and null join as "".
export function valueJoinString(raw: Value, t: ValueType, ctx: Ctx): Value {
  const members = membersOf(t);
  const nullish = members.filter((m) => m.kind === "undefined" || m.kind === "null");
  if (nullish.length === 0) return valueToString(raw, t, ctx);
  return switchOnValue(raw, members, T.ptr, ctx, (m) =>
    m.kind === "undefined" || m.kind === "null"
      ? ctx.mod.cstring("")
      : valueToString(raw, { kind: "value", members: [m] }, ctx),
  );
}

// `arr.includes(x)` compares with SameValueZero: like ===, except NaN matches NaN.
export function valueSameValueZero(a: Value, b: Value, ctx: Ctx): Value {
  const r = ctx.fn.call("@cs_value_same_zero", T.i32, [a, b]);
  return ctx.fn.icmp("ne", r, imm(T.i32, 0));
}

// JS truthiness of a Value word.
export function truthyValue(raw: Value, t: ValueType, ctx: Ctx): Value {
  return switchOnValue(raw, membersOf(t), T.i1, ctx, (m) => {
    switch (m.kind) {
      case "number":
        return ctx.fn.fcmp("one", unboxValue(raw, m, ctx), fimm(0));
      case "string": {
        const len = ctx.fn.call("@cs_str_len", T.i32, [unboxValue(raw, m, ctx)]);
        return ctx.fn.icmp("ne", len, imm(T.i32, 0));
      }
      case "boolean":
        return ctx.fn.icmp("eq", raw, imm(T.i64, V_TRUE));
      case "undefined":
      case "null":
        return imm(T.i1, 0);
      default:
        return imm(T.i1, 1); // every object, array and function is truthy
    }
  });
}

// The `typeof` word for a member kind.
function typeofName(m: ValueType): string {
  switch (m.kind) {
    case "number":
    case "string":
    case "boolean":
    case "undefined":
    case "function":
      return m.kind;
    case "null":
    case "object":
    case "array":
    case "map":
    case "set":
    case "promise":
    case "opaque":
    case "unknown":
      return "object";
    case "optional":
    case "value":
      return ice(`typeofName: ${m.kind} is not a single kind`);
    default: {
      const never: never = m;
      return ice(`typeofName: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// `typeof x` for an expression of any type: evaluated once, then answered from its kind.
export function evalTypeOf(value: HExpr, ctx: Ctx): Value {
  const members = membersOf(value.type);
  if (members.length === 1) {
    if (value.type.kind !== "undefined" && value.type.kind !== "null") evalValue(value, ctx);
    return ctx.mod.cstring(typeofName(members[0]!));
  }
  const raw = evalBoxed(value, ctx);
  return switchOnValue(raw, members, T.ptr, ctx, (m) => ctx.mod.cstring(typeofName(m)));
}

// A narrowing type test (`typeof x === "string"`, `Array.isArray(x)`) as a tag test.
export function evalTypeIs(value: HExpr, test: TypeTest, ctx: Ctx): Value {
  const holds = (m: ValueType): boolean =>
    test === "array" ? m.kind === "array" : typeofName(m) === test;
  const members = membersOf(value.type);
  if (members.length === 1) {
    if (value.type.kind !== "undefined" && value.type.kind !== "null") evalValue(value, ctx);
    return imm(T.i1, holds(members[0]!) ? 1 : 0);
  }
  const raw = evalBoxed(value, ctx);
  return switchOnValue(raw, members, T.i1, ctx, (m) => imm(T.i1, holds(m) ? 1 : 0));
}

// `x instanceof C`: the receiver's shape pointer equals C's or a subclass's. On a Value union (or a
// nullable object) only an object word can be an instance; every other kind answers false without
// touching memory.
export function evalInstanceof(expr: Extract<HExpr, { kind: "instanceofCheck" }>, ctx: Ctx): Value {
  const shapeMatches = (obj: Value): Value => {
    const shape = loadShape(obj, ctx);
    let acc: Value | null = null;
    for (const id of expr.shapes) {
      const eq = ctx.fn.icmp("eq", shape, shapeRef(ctx, id));
      acc = acc === null ? eq : ctx.fn.logicalOr(acc, eq);
    }
    return acc ?? imm(T.i1, 0);
  };
  const t = expr.value.type;
  if (t.kind === "object") return shapeMatches(evalObjectPtr(expr.value, ctx));
  if (t.kind === "value" || t.kind === "optional") {
    const raw = evalBoxed(expr.value, ctx);
    return switchOnValue(raw, membersOf(t), T.i1, ctx, (m) =>
      m.kind === "object" ? shapeMatches(unboxValue(raw, m, ctx)) : imm(T.i1, 0),
    );
  }
  return ice(`instanceof on ${t.kind} not supported yet`);
}

// `a === b` on two Value words (strictly: SameValue for everything except NaN and -0, which
// compare as numbers). The runtime does it because a string compare needs the bytes.
export function valueStrictEq(a: Value, b: Value, ctx: Ctx): Value {
  const r = ctx.fn.call("@cs_value_strict_eq", T.i32, [a, b]);
  return ctx.fn.icmp("ne", r, imm(T.i32, 0));
}

// JSON text of a Value. `undefined` has none as a value or field (JSON.stringify skips such a field
// and returns undefined for such a value; the validator keeps a top-level one out and the field
// writer skips the word before calling here), so the only `undefined` that arrives is an array
// element, which Node writes as `null`.
export function jsonValue(raw: Value, t: ValueType, ctx: Ctx, indent: Value, depth: Value): Value {
  return switchOnValue(raw, membersOf(t), T.ptr, ctx, (m) => {
    if (m.kind === "null" || m.kind === "undefined") return ctx.mod.cstring("null");
    return jsonStringify(unboxValue(raw, m, ctx), m, ctx, indent, depth);
  });
}
