// Expression lowering: HExpr → IR Value. Consumes HIR only — NO `typescript` import, no
// checker. Each HExpr already carries its resolved ValueType (stamped by lower/), so dispatch
// is on the HIR shape alone. JS number arithmetic is IEEE-754 f64, so the number domain maps
// straight to LLVM float instructions.

import { ice } from "../diagnostics.js";
import {
  fimm,
  imm,
  type Value,
  type ModuleBuilder,
  type FuncBuilder,
  type BasicBlock,
} from "../ir/builder.js";
import { T, type IrType } from "../ir/types.js";
import type { HExpr, BinaryOp } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { evalMathCall } from "./math.js";
import { evalMapPtr, evalMapGet, evalSetPtr, evalSetPredicate } from "./collections.js";
import { evalStrMethod } from "./strings.js";

export interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
  // Live variable slots: name → its stack pointer + resolved type.
  vars: Map<string, { ptr: Value; vtype: ValueType }>;
  // `break` targets (pushed by loops AND switch); `continue` targets (loops only, so continue
  // inside a switch correctly reaches the enclosing loop). Innermost last.
  // break/continue targets, innermost last. Each records the `finallyStack` depth at the loop's
  // (or switch's, for break) entry, so a break/continue can tell how many enclosing `finally`
  // blocks it must run before reaching the target.
  breakTargets: LoopTarget[];
  continueTargets: LoopTarget[];
  // Enclosing try blocks that intercept abrupt completions (return/break/continue) so their
  // `finally` runs first. Innermost last. See emitTry.
  finallyStack: TryFrame[];
  // The current function's declared return type (for the abrupt-return value slot); null = void.
  fnReturnType?: ValueType | null;
}

// A break/continue target block plus the finally-nesting depth at the enclosing loop/switch entry.
export interface LoopTarget {
  block: BasicBlock;
  finallyDepth: number;
}

// A try/catch/finally region's abrupt-completion routing. `code` (i32 alloca) holds the pending
// completion (0 normal, 1 return, 2 break, 3 continue, 4 throw); `retVal` holds a pending return
// value (null if void); `cleanupEntry` runs finally + dispatches. `index` is the frame's position
// in finallyStack; `enclosingBreak`/`enclosingContinue` are the loop/switch a crossing
// break/continue targets (captured at try entry) — the dispatch chains through outer finallys
// until reaching that target's depth.
export interface TryFrame {
  code: Value;
  retVal: Value | null;
  cleanupEntry: BasicBlock;
  index: number;
  enclosingBreak: LoopTarget | null;
  enclosingContinue: LoopTarget | null;
}

// The machine representation of a source-level type.
export function irTypeOf(vt: ValueType): IrType {
  switch (vt.kind) {
    case "number":
      return T.double;
    case "boolean":
      return T.i1;
    case "string":
      return T.ptr;
    case "array":
      return T.ptr; // pointer to the runtime array struct
    case "object":
      return T.ptr; // pointer to the GC record of field slots
    case "optional":
      return T.ptr; // the undefined sentinel, or a pointer to a boxed inner value
    case "function":
      return T.ptr; // pointer to a closure record {fnptr, env}
    case "map":
      return T.ptr; // pointer to the runtime CsMap
    case "set":
      return T.ptr; // pointer to the runtime CsSet
    case "unknown":
      return T.ptr; // pointer to a CsThrown (a caught value)
    case "null":
    case "undefined":
      return ice(`irTypeOf: ${vt.kind} has no storage representation yet`);
    default:
      return ice(`irTypeOf: unhandled ValueType ${(vt as { kind: string }).kind}`);
  }
}

// Box a value into a uniform 8-byte array slot (i64); unbox reverses it. Element boxing is
// per-type; only number is wired now (string[]/boolean[] land next).
export function boxSlot(v: Value, elemType: ValueType, ctx: Ctx): Value {
  switch (elemType.kind) {
    case "number":
      return ctx.fn.bitcastDoubleToI64(v);
    case "string":
    case "array":
    case "object":
    case "optional":
    case "function":
    case "map":
    case "set":
    case "unknown":
      return ctx.fn.ptrToI64(v); // all pointer-represented
    case "boolean":
      return ctx.fn.zextI1ToI64(v);
    default:
      return ice(`slot boxing not supported for ${elemType.kind} yet`);
  }
}

export function unboxSlot(slot: Value, elemType: ValueType, ctx: Ctx): Value {
  switch (elemType.kind) {
    case "number":
      return ctx.fn.bitcastI64ToDouble(slot);
    case "string":
    case "array":
    case "object":
    case "optional":
    case "function":
    case "map":
    case "set":
    case "unknown":
      return ctx.fn.i64ToPtr(slot);
    case "boolean":
      return ctx.fn.truncI64ToI1(slot);
    default:
      return ice(`slot unboxing not supported for ${elemType.kind} yet`);
  }
}

// Evaluate an object-typed HExpr to a ptr (to the GC record of i64 field slots).
export function evalObjectPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "objectLit": {
      if (expr.type.kind !== "object") return ice("objectLit not object-typed");
      const fields = expr.type.shape.fields;
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, fields.length * 8)]);
      expr.fields.forEach((f, i) => {
        const slot = boxSlot(evalValue(f, ctx), fields[i]!.type, ctx);
        ctx.fn.store(slot, ctx.fn.gepSlot(rec, i));
      });
      return rec;
    }
    case "new": {
      // A class instance reserves record slot 0 for its vtable pointer, so allocate one extra
      // slot and store the class's vtable there before running the constructor (which sets fields
      // starting at slot 1 via memberSet).
      const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, (expr.fieldCount + 1) * 8)]);
      ctx.fn.store(ctx.fn.ptrToI64(ctx.mod.vtableAddr(expr.className)), ctx.fn.gepSlot(rec, 0));
      const args = expr.args.map((a) => evalValue(a, ctx));
      // Constructors are static: run the nearest declared one (inherited if the class has none).
      if (expr.ctorClass !== null)
        ctx.fn.callVoid(`@${expr.ctorClass}.constructor`, [rec, ...args]);
      return rec;
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);
    default:
      return ice(`evalObjectPtr: unhandled object expression ${expr.kind}`);
  }
}

// Record-slot offset added to a field index: a class instance reserves slot 0 for its vtable
// pointer, so its fields start at slot 1; a plain object literal has no header.
export function headerOffset(objectType: ValueType): number {
  return objectType.kind === "object" && objectType.className !== undefined ? 1 : 0;
}

// Read `obj.field`: load the field's i64 slot and unbox it to the field type.
export function evalMemberGet(expr: Extract<HExpr, { kind: "memberGet" }>, ctx: Ctx): Value {
  const obj = evalObjectPtr(expr.object, ctx);
  const raw = ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, expr.slot + headerOffset(expr.object.type)));
  return unboxSlot(raw, expr.type, ctx);
}

// Evaluate an optional-typed HExpr to its pointer rep (undefined sentinel, or a box pointer).
export function evalOptionalPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "index") return evalIndex(expr, ctx);
  if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
  if (expr.kind === "arrayPop")
    return ctx.fn.call(`@${expr.fn}`, T.ptr, [evalArrayPtr(expr.array, ctx)]);
  if (expr.kind === "arrayAt")
    return ctx.fn.call("@cs_array_at", T.ptr, [
      evalArrayPtr(expr.array, ctx),
      evalNumber(expr.index, ctx),
    ]);
  if (expr.kind === "strAt")
    return ctx.fn.call("@cs_str_at", T.ptr, [
      evalString(expr.str, ctx),
      evalNumber(expr.index, ctx),
    ]);
  if (expr.kind === "memberGet") return evalMemberGet(expr, ctx); // an optional field
  if (expr.kind === "wrap") return evalWrap(expr, ctx);
  if (expr.kind === "undefinedOpt") return ctx.mod.externGlobal("cs_undefined_marker");
  if (expr.kind === "nullOpt") return ctx.mod.externGlobal("cs_null_marker");
  if (expr.kind === "call") return evalCall(expr, ctx);
  if (expr.kind === "callClosure") return evalCallClosure(expr, ctx);
  if (expr.kind === "virtualCall") return evalVirtualCall(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  if (expr.kind === "coalesce") return evalCoalesce(expr, ctx);
  if (expr.kind === "arrayHof") return evalArrayHof(expr, ctx); // .find() → element | undefined
  if (expr.kind === "mapGet") return evalMapGet(expr, ctx); // map.get() → value | undefined
  return ice(`evalOptionalPtr: unhandled optional expression ${expr.kind}`);
}

// Wrap an inner value into a present optional: a GC box holding the boxed inner value.
function evalWrap(expr: Extract<HExpr, { kind: "wrap" }>, ctx: Ctx): Value {
  const inner = expr.type.kind === "optional" ? expr.type.inner : ice("wrap: not optional-typed");
  const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(boxSlot(evalValue(expr.value, ctx), inner, ctx), box);
  return box;
}

// `arr[i]` → `element | undefined`, bounds-checked. In range: box the element; out of range: the
// undefined sentinel.
function evalIndex(expr: Extract<HExpr, { kind: "index" }>, ctx: Ctx): Value {
  const arr = evalArrayPtr(expr.array, ctx);
  const i = ctx.fn.fptosi_i32(evalNumber(expr.index, ctx));
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  const result = ctx.fn.alloca(T.ptr);

  const checkUpper = ctx.fn.newBlock("idx.check");
  const inB = ctx.fn.newBlock("idx.in");
  const outB = ctx.fn.newBlock("idx.out");
  const endB = ctx.fn.newBlock("idx.end");

  ctx.fn.brCond(ctx.fn.icmp("sge", i, imm(T.i32, 0)), checkUpper, outB);
  ctx.fn.switchTo(checkUpper);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), inB, outB);

  ctx.fn.switchTo(inB);
  const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), box); // store the raw i64 slot
  ctx.fn.store(box, result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(outB);
  ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// Unbox a present optional pointer (a box) to its inner value.
export function unboxOptionalValue(optPtr: Value, innerType: ValueType, ctx: Ctx): Value {
  return unboxSlot(ctx.fn.load(T.i64, optPtr), innerType, ctx);
}

// Unbox a raw i64 slot value to `type` (e.g. a capture loaded from a closure env).
export function unboxSlotValue(raw: Value, type: ValueType, ctx: Ctx): Value {
  return unboxSlot(raw, type, ctx);
}

// Unwrap a narrowed optional (proven present by an `x !== undefined` guard): load its box and
// unbox to the inner type.
export function evalUnwrap(expr: Extract<HExpr, { kind: "unwrap" }>, ctx: Ctx): Value {
  return unboxOptionalValue(evalOptionalPtr(expr.value, ctx), expr.type, ctx);
}

// True when an optional pointer is either nullish sentinel (undefined OR null). Used by `??`
// (both are nullish) and by console.log's optional branch.
export function isNullishPtr(opt: Value, ctx: Ctx): Value {
  const isUndef = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker"));
  return ctx.fn.logicalOr(isUndef, isNull);
}

// `x === null`/`x === undefined` (and `!==`) → i1. `sentinel` selects which marker to compare,
// so the null and undefined cases stay distinct for a `T | null | undefined` value.
export function evalNullCheck(expr: Extract<HExpr, { kind: "nullCheck" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.value, ctx);
  const marker = expr.sentinel === "null" ? "cs_null_marker" : "cs_undefined_marker";
  return ctx.fn.icmp(expr.isEqual ? "eq" : "ne", opt, ctx.mod.externGlobal(marker));
}

// `===`/`!==` between an optional (`T | undefined`) and a CONCRETE value of the inner type — e.g.
// `str.at(i) !== "h"`, `parts[0] === "apple"`. (Optional-vs-null/undefined lowers to a nullCheck
// instead.) JS: an absent optional never equals a concrete value, so `===` is false / `!==` true
// when absent; when present, unwrap and compare the inner values by their type.
function evalOptionalEquality(optExpr: HExpr, otherExpr: HExpr, isNe: boolean, ctx: Ctx): Value {
  if (optExpr.type.kind !== "optional") return ice("evalOptionalEquality: not optional-typed");
  const innerType = optExpr.type.inner;
  const opt = evalOptionalPtr(optExpr, ctx);
  const other = evalValue(otherExpr, ctx); // evaluate once, before the branch (dominates both)
  const result = ctx.fn.alloca(T.i1);
  const absentB = ctx.fn.newBlock("opteq.absent");
  const presentB = ctx.fn.newBlock("opteq.present");
  const endB = ctx.fn.newBlock("opteq.end");

  ctx.fn.brCond(isNullishPtr(opt, ctx), absentB, presentB);

  ctx.fn.switchTo(absentB); // absent ≠ any concrete value
  ctx.fn.store(imm(T.i1, isNe ? 1 : 0), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(presentB);
  const inner = unboxSlot(ctx.fn.load(T.i64, opt), innerType, ctx);
  const eq = emitStrictEq(inner, other, innerType, ctx);
  ctx.fn.store(isNe ? ctx.fn.logicalNot(eq) : eq, result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.i1, result);
}

// `a ?? b`: if `a` is nullish (undefined OR null), use `b`; else unwrap the boxed inner value.
export function evalCoalesce(expr: Extract<HExpr, { kind: "coalesce" }>, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr.left, ctx);
  const isUndef = isNullishPtr(opt, ctx);
  const result = ctx.fn.alloca(irTypeOf(expr.type));

  const defB = ctx.fn.newBlock("nn.default");
  const presentB = ctx.fn.newBlock("nn.present");
  const endB = ctx.fn.newBlock("nn.end");

  ctx.fn.brCond(isUndef, defB, presentB);
  ctx.fn.switchTo(defB);
  ctx.fn.store(evalValue(expr.right, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(presentB);
  ctx.fn.store(unboxSlot(ctx.fn.load(T.i64, opt), expr.type, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(irTypeOf(expr.type), result);
}

// Evaluate an array-typed HExpr to a ptr (to the runtime array struct).
export function evalArrayPtr(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "arrayLit": {
      const arr = ctx.fn.call("@cs_array_new", T.ptr, []);
      const elemType = expr.type.kind === "array" ? expr.type.element : ice("arrayLit not array");
      for (const el of expr.elements) {
        if (el.spread) {
          // Copy the source array's boxed slots directly (same element type → no re-box).
          ctx.fn.callVoid("@cs_array_extend", [arr, evalArrayPtr(el.value, ctx)]);
        } else {
          ctx.fn.call("@cs_array_push", T.i32, [
            arr,
            boxSlot(evalValue(el.value, ctx), elemType, ctx),
          ]);
        }
      }
      return arr;
    }
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "strMethod":
      return evalStrMethod(expr, ctx); // e.g. "a,b".split(",")
    case "arrayXform":
      // reverse/slice/concat → a single runtime call over the array ptr + extra args.
      return ctx.fn.call(`@${expr.fn}`, T.ptr, [
        evalArrayPtr(expr.array, ctx),
        ...expr.args.map((a) => evalValue(a, ctx)),
      ]);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);
    case "arrayHof":
      return evalArrayHof(expr, ctx); // .map()/.filter() (also when chained as a receiver)
    case "arraySort":
      return evalArraySort(expr, ctx);
    case "collectionToArray":
      // map.keys()/values() / set.values() → a materialized array of boxed slots.
      return ctx.fn.call(`@${expr.fn}`, T.ptr, [evalValue(expr.receiver, ctx)]);
    default:
      return ice(`evalArrayPtr: unhandled array expression ${expr.kind}`);
  }
}

// Load one element out of an array pointer at index `i` (i32), unboxed to `elemType`.
export function arrayElementAt(arr: Value, i: Value, elemType: ValueType, ctx: Ctx): Value {
  return unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), elemType, ctx);
}

// Strict-equality (`===`) of two already-computed Values, dispatched on their shared type.
// Matches JS: numbers via ordered fcmp oeq (NaN===NaN false), booleans via icmp, strings via
// the runtime string compare. Shared by `switch` and array `.includes`/`.indexOf`.
export function emitStrictEq(a: Value, b: Value, type: ValueType, ctx: Ctx): Value {
  switch (type.kind) {
    case "number":
      return ctx.fn.fcmp("oeq", a, b);
    case "boolean":
      return ctx.fn.icmp("eq", a, b);
    case "string":
      return ctx.fn.icmp("ne", ctx.fn.call("@cs_str_eq", T.i32, [a, b]), imm(T.i32, 0));
    default:
      return ice(`emitStrictEq: ${type.kind} not supported`);
  }
}

// `arr.includes(x)` / `arr.indexOf(x)` share a linear scan with early exit. `wantIndex` picks
// the return: the matching index as a number (−1 if none), or a boolean found-flag.
export function evalArraySearch(
  array: HExpr,
  value: HExpr,
  elementType: ValueType,
  wantIndex: boolean,
  ctx: Ctx,
): Value {
  const arrSlot = ctx.fn.alloca(T.ptr);
  ctx.fn.store(evalArrayPtr(array, ctx), arrSlot);
  const target = evalValue(value, ctx); // evaluated once, before the loop
  const idxSlot = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, 0), idxSlot);

  const headerB = ctx.fn.newBlock("find.header");
  const bodyB = ctx.fn.newBlock("find.body");
  const contB = ctx.fn.newBlock("find.cont");
  const endB = ctx.fn.newBlock("find.end");

  ctx.fn.br(headerB);
  ctx.fn.switchTo(headerB);
  const i = ctx.fn.load(T.i32, idxSlot);
  const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrSlot)]);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), bodyB, endB);

  ctx.fn.switchTo(bodyB);
  const elem = arrayElementAt(ctx.fn.load(T.ptr, arrSlot), i, elementType, ctx);
  ctx.fn.brCond(emitStrictEq(elem, target, elementType, ctx), endB, contB); // match → stop

  ctx.fn.switchTo(contB);
  ctx.fn.store(ctx.fn.iadd(i, imm(T.i32, 1)), idxSlot);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(endB);
  // On a match we exited from bodyB with idxSlot holding the found index; if the header's
  // condition failed we fell through with idx == len (no match).
  const found = ctx.fn.icmp(
    "slt",
    ctx.fn.load(T.i32, idxSlot),
    ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrSlot)]),
  );
  if (!wantIndex) return found;
  // indexOf: the found index as a number, or -1.
  return ctx.fn.select(found, ctx.fn.sitofp(ctx.fn.load(T.i32, idxSlot)), fimm(-1));
}

// Coerce an already-computed Value to its JS string form (a ptr), per its type.
export function coerceValueToString(v: Value, type: ValueType, ctx: Ctx): Value {
  switch (type.kind) {
    case "string":
      return v;
    case "number":
      return ctx.fn.call("@cs_num_to_string", T.ptr, [v]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(v)]);
    default:
      return ice(`coerceValueToString: ${type.kind} not supported`);
  }
}

// `arr.join(sep)`: fold the elements into a string, separated by `sep` (default ","). The
// separator is prepended before every element except the first (via a select on the index).
export function evalArrayJoin(expr: Extract<HExpr, { kind: "arrayJoin" }>, ctx: Ctx): Value {
  const arrSlot = ctx.fn.alloca(T.ptr);
  ctx.fn.store(evalArrayPtr(expr.array, ctx), arrSlot);
  const sep = expr.separator ? evalString(expr.separator, ctx) : ctx.mod.cstring(",");
  const empty = ctx.mod.cstring("");
  const resultSlot = ctx.fn.alloca(T.ptr);
  ctx.fn.store(empty, resultSlot);
  const idxSlot = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, 0), idxSlot);

  const headerB = ctx.fn.newBlock("join.header");
  const bodyB = ctx.fn.newBlock("join.body");
  const endB = ctx.fn.newBlock("join.end");

  ctx.fn.br(headerB);
  ctx.fn.switchTo(headerB);
  const i = ctx.fn.load(T.i32, idxSlot);
  const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrSlot)]);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), bodyB, endB);

  ctx.fn.switchTo(bodyB);
  const arr = ctx.fn.load(T.ptr, arrSlot);
  const idx = ctx.fn.load(T.i32, idxSlot);
  const elemStr = coerceValueToString(
    arrayElementAt(arr, idx, expr.elementType, ctx),
    expr.elementType,
    ctx,
  );
  const prefix = ctx.fn.select(ctx.fn.icmp("eq", idx, imm(T.i32, 0)), empty, sep);
  let acc = ctx.fn.call("@cs_str_concat", T.ptr, [ctx.fn.load(T.ptr, resultSlot), prefix]);
  acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, elemStr]);
  ctx.fn.store(acc, resultSlot);
  ctx.fn.store(ctx.fn.iadd(idx, imm(T.i32, 1)), idxSlot);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, resultSlot);
}

export function lookupVar(name: string, ctx: Ctx): { ptr: Value; vtype: ValueType } {
  const slot = ctx.vars.get(name);
  if (!slot) ice(`codegen: reference to unbound variable ${name}`);
  return slot;
}

// A value-returning call: evaluate each argument to a Value, then call. The callee's IR name
// is its HIR name; the return IR type comes from the call's resolved (non-void) type.
export function evalCall(expr: Extract<HExpr, { kind: "call" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalValue(a, ctx));
  return ctx.fn.call(`@${expr.name}`, irTypeOf(expr.type), args);
}

// Create a closure: a GC record {fnptr, env}. `env` holds the captured values (or null when
// there are no captures). Captures are read from the enclosing scope at creation time.
export function evalClosure(expr: Extract<HExpr, { kind: "closure" }>, ctx: Ctx): Value {
  let env: Value;
  if (expr.captures.length > 0) {
    env = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, expr.captures.length * 8)]);
    expr.captures.forEach((c, i) => {
      const slot = lookupVar(c.name, ctx);
      const v = ctx.fn.load(irTypeOf(c.type), slot.ptr);
      ctx.fn.store(boxSlot(v, c.type, ctx), ctx.fn.gepSlot(env, i));
    });
  } else {
    env = ctx.fn.nullPtr();
  }
  const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 16)]); // {fnptr, env}
  ctx.fn.store(ctx.fn.ptrToI64(ctx.fn.funcRef(expr.lambdaName)), ctx.fn.gepSlot(rec, 0));
  ctx.fn.store(ctx.fn.ptrToI64(env), ctx.fn.gepSlot(rec, 1));
  return rec;
}

// Evaluate a function-typed HExpr to a closure-record pointer.
export function evalFunctionPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "closure") return evalClosure(expr, ctx);
  if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
  if (expr.kind === "call") return evalCall(expr, ctx);
  if (expr.kind === "callClosure") return evalCallClosure(expr, ctx);
  if (expr.kind === "virtualCall") return evalVirtualCall(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  return ice(`evalFunctionPtr: unhandled function expression ${expr.kind}`);
}

// Virtual method call: load the receiver's vtable pointer (record slot 0), index it for the
// method's fn pointer, and call it with the receiver prepended. `retType` void → the caller uses
// the statement form (evalVirtualCallStmt); here a value is always produced.
export function evalVirtualCall(expr: Extract<HExpr, { kind: "virtualCall" }>, ctx: Ctx): Value {
  const { obj, fnptr } = loadVirtualTarget(expr.receiver, expr.vtableIndex, ctx);
  const args = [obj, ...expr.args.map((a) => evalValue(a, ctx))];
  return ctx.fn.callIndirect(fnptr, irTypeOf(expr.type), args);
}

// Shared receiver+fnptr resolution for the value and statement forms of a virtual call.
function loadVirtualTarget(
  receiver: HExpr,
  vtableIndex: number,
  ctx: Ctx,
): { obj: Value; fnptr: Value } {
  const obj = evalObjectPtr(receiver, ctx);
  const vtbl = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, 0)));
  const fnptr = ctx.fn.load(T.ptr, ctx.fn.gepPtr(vtbl, vtableIndex));
  return { obj, fnptr };
}

// Statement-position virtual call (void methods, or a discarded value). `returnType` null → void.
export function evalVirtualCallStmt(
  receiver: HExpr,
  vtableIndex: number,
  args: HExpr[],
  returnType: ValueType | null,
  ctx: Ctx,
): void {
  const { obj, fnptr } = loadVirtualTarget(receiver, vtableIndex, ctx);
  const argVals = [obj, ...args.map((a) => evalValue(a, ctx))];
  if (returnType === null) ctx.fn.callIndirectVoid(fnptr, argVals);
  else ctx.fn.callIndirect(fnptr, irTypeOf(returnType), argVals);
}

// Call a closure value: load its fnptr + env and invoke fnptr(env, args...).
export function evalCallClosure(expr: Extract<HExpr, { kind: "callClosure" }>, ctx: Ctx): Value {
  const rec = evalValue(expr.callee, ctx);
  const fnptr = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(rec, 0)));
  const env = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(rec, 1)));
  const args = [env, ...expr.args.map((a) => evalValue(a, ctx))];
  return ctx.fn.callIndirect(fnptr, irTypeOf(expr.type), args);
}

// Higher-order array methods (map/filter/forEach/reduce), lowered to an inline loop that
// invokes the callback closure per element. The closure is called with the SAME typed ABI as a
// direct call: `fnptr(env, typedArgs...)`. JS passes (element, index, array); we pass exactly as
// many as the callback's arity declares (element + optional index; reduce leads with the acc).
export function evalArrayHof(expr: Extract<HExpr, { kind: "arrayHof" }>, ctx: Ctx): Value {
  const cbType = expr.callback.type;
  if (cbType.kind !== "function") return ice("arrayHof callback is not function-typed");
  const arity = cbType.params.length;
  const retIr = cbType.ret ? irTypeOf(cbType.ret) : T.void;

  const arr = evalArrayPtr(expr.array, ctx);
  const cb = evalFunctionPtr(expr.callback, ctx);
  const fnptr = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(cb, 0)));
  const env = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(cb, 1)));

  const arrPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(arr, arrPtr);
  const idxPtr = ctx.fn.alloca(T.i32);

  // map/filter build a fresh array; reduce accumulates into a typed slot.
  const result =
    expr.op === "map" || expr.op === "filter" || expr.op === "flatMap"
      ? ctx.fn.call("@cs_array_new", T.ptr, [])
      : null;
  const accPtr = expr.op === "reduce" ? ctx.fn.alloca(irTypeOf(expr.type)) : null;

  // Predicate ops (find/findIndex/some/every) hold a result slot seeded with the "no match"
  // answer; a matching element stores its answer and early-exits the loop.
  const isPredicate =
    expr.op === "find" || expr.op === "findIndex" || expr.op === "some" || expr.op === "every";
  const predPtr = isPredicate ? ctx.fn.alloca(irTypeOf(expr.type)) : null;
  if (expr.op === "find") ctx.fn.store(ctx.mod.externGlobal("cs_undefined_marker"), predPtr!);
  else if (expr.op === "findIndex") ctx.fn.store(fimm(-1), predPtr!);
  else if (expr.op === "some") ctx.fn.store(imm(T.i1, 0), predPtr!);
  else if (expr.op === "every") ctx.fn.store(imm(T.i1, 1), predPtr!);

  // reduce without an initial value seeds the accumulator from element 0 and starts at index 1.
  let startIdx = 0;
  if (expr.op === "reduce") {
    if (expr.init) {
      ctx.fn.store(evalValue(expr.init, ctx), accPtr!);
    } else {
      ctx.fn.store(
        unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, imm(T.i32, 0)]), expr.type, ctx),
        accPtr!,
      );
      startIdx = 1;
    }
  }
  ctx.fn.store(imm(T.i32, startIdx), idxPtr);

  const headerB = ctx.fn.newBlock("hof.header");
  const bodyB = ctx.fn.newBlock("hof.body");
  const latchB = ctx.fn.newBlock("hof.latch");
  const endB = ctx.fn.newBlock("hof.end");

  ctx.fn.br(headerB);
  ctx.fn.switchTo(headerB);
  const i = ctx.fn.load(T.i32, idxPtr);
  const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrPtr)]);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), bodyB, endB);

  ctx.fn.switchTo(bodyB);
  const idx = ctx.fn.load(T.i32, idxPtr);
  const elemI64 = ctx.fn.call("@cs_array_get", T.i64, [ctx.fn.load(T.ptr, arrPtr), idx]);
  const elem = unboxSlot(elemI64, expr.elementType, ctx);

  if (expr.op === "reduce") {
    // callback(acc, element, index?)
    const args = [env, ctx.fn.load(irTypeOf(expr.type), accPtr!), elem];
    if (arity >= 3) args.push(ctx.fn.sitofp(idx));
    ctx.fn.store(ctx.fn.callIndirect(fnptr, retIr, args), accPtr!);
    ctx.fn.br(latchB);
  } else {
    // callback(element, index?)
    const args = [env, elem];
    if (arity >= 2) args.push(ctx.fn.sitofp(idx));
    if (expr.op === "map") {
      const mapped = ctx.fn.callIndirect(fnptr, retIr, args);
      ctx.fn.call("@cs_array_push", T.i32, [result!, boxSlot(mapped, cbType.ret!, ctx)]);
      ctx.fn.br(latchB);
    } else if (expr.op === "flatMap") {
      // callback returns an array (T[]); splice its elements into the result (depth-1 flatten).
      const mapped = ctx.fn.callIndirect(fnptr, T.ptr, args);
      ctx.fn.callVoid("@cs_array_extend", [result!, mapped]);
      ctx.fn.br(latchB);
    } else if (expr.op === "filter") {
      const keep = ctx.fn.callIndirect(fnptr, T.i1, args);
      const pushB = ctx.fn.newBlock("hof.push");
      ctx.fn.brCond(keep, pushB, latchB);
      ctx.fn.switchTo(pushB);
      ctx.fn.call("@cs_array_push", T.i32, [result!, elemI64]); // keep the original boxed slot
      ctx.fn.br(latchB);
    } else if (isPredicate) {
      const keep = ctx.fn.callIndirect(fnptr, T.i1, args);
      const hitB = ctx.fn.newBlock("hof.hit");
      // every early-exits on the FIRST false; the others on the first true.
      if (expr.op === "every") ctx.fn.brCond(keep, latchB, hitB);
      else ctx.fn.brCond(keep, hitB, latchB);
      ctx.fn.switchTo(hitB);
      if (expr.op === "find") {
        const box = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
        ctx.fn.store(elemI64, box); // present optional: a box holding the element's raw slot
        ctx.fn.store(box, predPtr!);
      } else if (expr.op === "findIndex") {
        ctx.fn.store(ctx.fn.sitofp(idx), predPtr!);
      } else if (expr.op === "some") {
        ctx.fn.store(imm(T.i1, 1), predPtr!);
      } else {
        ctx.fn.store(imm(T.i1, 0), predPtr!); // every: a false element makes the whole false
      }
      ctx.fn.br(endB); // early exit — no need to scan the rest
    } else {
      // forEach: invoke for side effects, discard the result.
      if (cbType.ret) ctx.fn.callIndirect(fnptr, retIr, args);
      else ctx.fn.callIndirectVoid(fnptr, args);
      ctx.fn.br(latchB);
    }
  }

  ctx.fn.switchTo(latchB);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
  ctx.fn.br(headerB);

  ctx.fn.switchTo(endB);
  if (expr.op === "reduce") return ctx.fn.load(irTypeOf(expr.type), accPtr!);
  if (predPtr) return ctx.fn.load(irTypeOf(expr.type), predPtr!);
  if (result) return result;
  return ctx.fn.nullPtr(); // forEach → undefined (discarded by the caller)
}

// `arr.sort(cmp?)`: in-place insertion sort over the array's i64 slots, returning the same
// array (JS sort mutates and returns the receiver). A comparator returns a number whose sign
// orders the pair; the default order compares String(element) lexicographically.
export function evalArraySort(expr: Extract<HExpr, { kind: "arraySort" }>, ctx: Ctx): Value {
  const arr = evalArrayPtr(expr.array, ctx);
  const arrPtr = ctx.fn.alloca(T.ptr);
  ctx.fn.store(arr, arrPtr);
  const get = (i: Value): Value =>
    ctx.fn.call("@cs_array_get", T.i64, [ctx.fn.load(T.ptr, arrPtr), i]);
  const set = (i: Value, slot: Value): void =>
    ctx.fn.callVoid("@cs_array_set", [ctx.fn.load(T.ptr, arrPtr), i, slot]);

  // Stringify a raw slot for the default comparison (number/string/boolean elements).
  const strOfSlot = (slot: Value): Value => {
    switch (expr.elementType.kind) {
      case "string":
        return ctx.fn.i64ToPtr(slot);
      case "number":
        return ctx.fn.call("@cs_num_to_string", T.ptr, [ctx.fn.bitcastI64ToDouble(slot)]);
      case "boolean":
        return ctx.fn.call("@cs_bool_to_string", T.ptr, [
          ctx.fn.zextI1ToI32(ctx.fn.truncI64ToI1(slot)),
        ]);
      default:
        return ice(`sort: default comparison unsupported for ${expr.elementType.kind}[]`);
    }
  };

  // Load the comparator closure once, if provided.
  let cmpFn: Value | null = null;
  let cmpEnv: Value | null = null;
  if (expr.comparator) {
    const cb = evalFunctionPtr(expr.comparator, ctx);
    cmpFn = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(cb, 0)));
    cmpEnv = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(cb, 1)));
  }

  // Whether slot `a` should sort AFTER slot `key` (strictly greater under the ordering).
  const aAfterKey = (a: Value, key: Value): Value => {
    if (cmpFn) {
      const r = ctx.fn.callIndirect(cmpFn, T.double, [
        cmpEnv!,
        unboxSlot(a, expr.elementType, ctx),
        unboxSlot(key, expr.elementType, ctx),
      ]);
      return ctx.fn.fcmp("ogt", r, fimm(0));
    }
    const c = ctx.fn.call("@cs_str_cmp", T.i32, [strOfSlot(a), strOfSlot(key)]);
    return ctx.fn.icmp("sgt", c, imm(T.i32, 0));
  };

  // for (i = 1; i < len; i++) { key = a[i]; j = i-1; while (j>=0 && a[j] after key) { a[j+1]=a[j]; j--; } a[j+1]=key; }
  const iPtr = ctx.fn.alloca(T.i32);
  const jPtr = ctx.fn.alloca(T.i32);
  const keyPtr = ctx.fn.alloca(T.i64);
  ctx.fn.store(imm(T.i32, 1), iPtr);

  const outerH = ctx.fn.newBlock("sort.outer");
  const outerB = ctx.fn.newBlock("sort.outer.body");
  const innerH = ctx.fn.newBlock("sort.inner");
  const innerCmp = ctx.fn.newBlock("sort.inner.cmp");
  const innerB = ctx.fn.newBlock("sort.inner.body");
  const place = ctx.fn.newBlock("sort.place");
  const outerL = ctx.fn.newBlock("sort.outer.latch");
  const endB = ctx.fn.newBlock("sort.end");

  ctx.fn.br(outerH);
  ctx.fn.switchTo(outerH);
  const i = ctx.fn.load(T.i32, iPtr);
  const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrPtr)]);
  ctx.fn.brCond(ctx.fn.icmp("slt", i, len), outerB, endB);

  ctx.fn.switchTo(outerB);
  ctx.fn.store(get(ctx.fn.load(T.i32, iPtr)), keyPtr);
  ctx.fn.store(ctx.fn.isub(ctx.fn.load(T.i32, iPtr), imm(T.i32, 1)), jPtr);
  ctx.fn.br(innerH);

  ctx.fn.switchTo(innerH);
  // j >= 0 ?
  ctx.fn.brCond(ctx.fn.icmp("sge", ctx.fn.load(T.i32, jPtr), imm(T.i32, 0)), innerCmp, place);
  ctx.fn.switchTo(innerCmp);
  const j = ctx.fn.load(T.i32, jPtr);
  const aj = get(j);
  ctx.fn.brCond(aAfterKey(aj, ctx.fn.load(T.i64, keyPtr)), innerB, place);

  ctx.fn.switchTo(innerB);
  // a[j+1] = a[j]; j--
  set(ctx.fn.iadd(ctx.fn.load(T.i32, jPtr), imm(T.i32, 1)), get(ctx.fn.load(T.i32, jPtr)));
  ctx.fn.store(ctx.fn.isub(ctx.fn.load(T.i32, jPtr), imm(T.i32, 1)), jPtr);
  ctx.fn.br(innerH);

  ctx.fn.switchTo(place);
  // a[j+1] = key
  set(ctx.fn.iadd(ctx.fn.load(T.i32, jPtr), imm(T.i32, 1)), ctx.fn.load(T.i64, keyPtr));
  ctx.fn.br(outerL);

  ctx.fn.switchTo(outerL);
  ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, iPtr), imm(T.i32, 1)), iPtr);
  ctx.fn.br(outerH);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, arrPtr);
}

// Ternary `cond ? a : b`. Branches may have side effects, so each arm is evaluated in its own
// block and merged through a result slot (not a `select`, which would evaluate both arms).
export function evalConditional(expr: Extract<HExpr, { kind: "conditional" }>, ctx: Ctx): Value {
  // JS applies ToBoolean to the condition — route through toBool (type-aware truthiness), NOT
  // evalBool, whose varRef case type-blindly loads an i1 and misreads string/number conditions.
  const cond = toBool(expr.cond, ctx);
  const result = ctx.fn.alloca(irTypeOf(expr.type));
  const trueB = ctx.fn.newBlock("cond.true");
  const falseB = ctx.fn.newBlock("cond.false");
  const endB = ctx.fn.newBlock("cond.end");

  ctx.fn.brCond(cond, trueB, falseB);
  ctx.fn.switchTo(trueB);
  ctx.fn.store(evalValue(expr.whenTrue, ctx), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(falseB);
  ctx.fn.store(evalValue(expr.whenFalse, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(irTypeOf(expr.type), result);
}

// String methods: each maps to a runtime call. `ret` picks the IR return type and any bool
// conversion (the runtime returns i32 0/1 for predicates).
// Evaluate any supported HExpr to an IR Value, dispatched on its resolved type.
export function evalValue(expr: HExpr, ctx: Ctx): Value {
  // arrayHof spans result types (map/filter→array, reduce→any, forEach→undefined); handle it
  // before the type switch so forEach's `undefined` result type doesn't hit the default ICE.
  if (expr.kind === "arrayHof") return evalArrayHof(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  switch (expr.type.kind) {
    case "number":
      return evalNumber(expr, ctx);
    case "boolean":
      return evalBool(expr, ctx);
    case "string":
      return evalString(expr, ctx);
    case "array":
      return evalArrayPtr(expr, ctx);
    case "object":
      return evalObjectPtr(expr, ctx);
    case "optional":
      return evalOptionalPtr(expr, ctx);
    case "function":
      return evalFunctionPtr(expr, ctx);
    case "map":
      return evalMapPtr(expr, ctx);
    case "set":
      return evalSetPtr(expr, ctx);
    case "unknown":
      // A caught value (CsThrown*): only a `varRef` (the catch binding) produces one directly.
      if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
      return ice(`evalValue: unknown expression ${expr.kind}`);
    default:
      return ice(`evalValue: ${expr.type.kind} not supported yet`);
  }
}

// Evaluate a string-typed HExpr to a ptr Value (cstring for a literal; a load for a varRef).
export function evalString(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "stringLit":
      return ctx.mod.cstring(expr.value);
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "call":
      return evalCall(expr, ctx);
    case "logical":
      return evalLogical(expr, ctx);
    case "binary":
      // The only string-producing binary is `+` (concatenation); each operand is coerced.
      if (expr.op === "add") {
        return ctx.fn.call("@cs_str_concat", T.ptr, [
          coerceToString(expr.left, ctx),
          coerceToString(expr.right, ctx),
        ]);
      }
      return ice(`evalString: binary op ${expr.op} does not produce a string`);
    case "template":
      return evalTemplate(expr, ctx);
    case "memberGet":
      return evalMemberGet(expr, ctx);
    case "strMethod":
      return evalStrMethod(expr, ctx);
    case "numToString":
      return expr.radix === null
        ? ctx.fn.call("@cs_num_to_string", T.ptr, [evalNumber(expr.value, ctx)])
        : ctx.fn.call("@cs_num_to_string_radix", T.ptr, [
            evalNumber(expr.value, ctx),
            evalNumber(expr.radix, ctx),
          ]);

    case "convert": // `String(x)` — the same coercion as `"" + x`.
      return coerceToString(expr.value, ctx);

    case "arrayJoin":
      return evalArrayJoin(expr, ctx);
    case "coalesce":
      return evalCoalesce(expr, ctx);
    case "unwrap":
      return evalUnwrap(expr, ctx);
    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);
    default:
      return ice(`evalString: unhandled string expression ${expr.kind}`);
  }
}

// Coerce any supported value to its JS string form (a ptr). Numbers use Number::toString (so
// `"" + -0` is "0", unlike console.log(-0)); booleans → "true"/"false"; strings pass through.
function coerceToString(expr: HExpr, ctx: Ctx): Value {
  switch (expr.type.kind) {
    case "string":
      return evalString(expr, ctx);
    case "number":
      return ctx.fn.call("@cs_num_to_string", T.ptr, [evalNumber(expr, ctx)]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(evalBool(expr, ctx))]);
    case "unknown":
      // `String(e)` on a caught value: "Error: <msg>" for an Error, else the thrown string.
      return ctx.fn.call("@cs_thrown_to_string", T.ptr, [evalValue(expr, ctx)]);
    case "null":
      return ctx.mod.cstring("null");
    case "undefined":
      return ctx.mod.cstring("undefined");
    case "optional":
      return coerceOptionalToString(expr, expr.type.inner, ctx);
    default:
      return ice(`coerceToString: ${expr.type.kind} not supported yet`);
  }
}

// String coercion of a `T | null | undefined`: JS spells the absent cases "undefined"/"null" and
// coerces a present value by its inner type. Branches on the two nullish sentinels at runtime.
function coerceOptionalToString(expr: HExpr, inner: ValueType, ctx: Ctx): Value {
  const opt = evalOptionalPtr(expr, ctx);
  const result = ctx.fn.alloca(T.ptr);
  const undefB = ctx.fn.newBlock("cts.undef");
  const notUndefB = ctx.fn.newBlock("cts.notundef");
  const nullB = ctx.fn.newBlock("cts.null");
  const presentB = ctx.fn.newBlock("cts.present");
  const endB = ctx.fn.newBlock("cts.end");

  ctx.fn.brCond(
    ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker")),
    undefB,
    notUndefB,
  );
  ctx.fn.switchTo(undefB);
  ctx.fn.store(ctx.mod.cstring("undefined"), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker")), nullB, presentB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.cstring("null"), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(presentB);
  const innerVal = unboxSlot(ctx.fn.load(T.i64, opt), inner, ctx);
  ctx.fn.store(coerceValueToString(innerVal, inner, ctx), result);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// A template literal: fold quasis and interpolations left-to-right with concatenation.
function evalTemplate(expr: Extract<HExpr, { kind: "template" }>, ctx: Ctx): Value {
  let acc = ctx.mod.cstring(expr.quasis[0]!);
  for (let i = 0; i < expr.exprs.length; i++) {
    acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, coerceToString(expr.exprs[i]!, ctx)]);
    acc = ctx.fn.call("@cs_str_concat", T.ptr, [acc, ctx.mod.cstring(expr.quasis[i + 1]!)]);
  }
  return acc;
}

const RELATIONAL: Partial<Record<BinaryOp, string>> = {
  lt: "olt",
  gt: "ogt",
  le: "ole",
  ge: "oge",
};

// Evaluate a number-typed HExpr to a double Value.
export function evalNumber(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "numberLit":
      return fimm(expr.value);

    case "varRef":
      return ctx.fn.load(T.double, lookupVar(expr.name, ctx).ptr);

    case "call":
      return evalCall(expr, ctx);

    case "mathCall":
      return evalMathCall(expr, ctx);

    case "runtimeCall":
      // A direct runtime-entry call (parseInt/parseFloat). Args are passed positionally.
      return ctx.fn.call(`@${expr.fn}`, T.double, [...expr.args.map((a) => evalValue(a, ctx))]);

    case "strLen":
      return ctx.fn.sitofp(ctx.fn.call("@cs_str_len", T.i32, [evalString(expr.str, ctx)]));

    case "strMethod":
      return evalStrMethod(expr, ctx);

    case "coalesce":
      return evalCoalesce(expr, ctx);

    case "unwrap":
      return evalUnwrap(expr, ctx);

    case "arraySearch":
      return evalArraySearch(expr.array, expr.value, expr.elementType, expr.wantIndex, ctx);

    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);

    case "arrayHof":
      return evalArrayHof(expr, ctx); // reduce → number

    case "mapSize":
      return ctx.fn.sitofp(ctx.fn.call("@cs_map_size", T.i32, [evalMapPtr(expr.map, ctx)]));

    case "setSize":
      return ctx.fn.sitofp(ctx.fn.call("@cs_set_size", T.i32, [evalSetPtr(expr.set, ctx)]));

    case "convert": // `Number(x)`
      return evalNumberConvert(expr.value, ctx);

    case "arrayLen":
      // JS .length is a number; the runtime returns an i32 count.
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_len", T.i32, [evalArrayPtr(expr.array, ctx)]));

    case "arrayPush": {
      // push returns the new length (a number). Box the value into a slot first.
      const arr = evalArrayPtr(expr.array, ctx);
      const slot = boxSlot(evalValue(expr.value, ctx), expr.elementType, ctx);
      return ctx.fn.sitofp(ctx.fn.call("@cs_array_push", T.i32, [arr, slot]));
    }

    case "memberGet":
      return evalMemberGet(expr, ctx);

    case "logical":
      return evalLogical(expr, ctx);

    case "unary": {
      const op = expr.op;
      switch (op) {
        case "neg":
          return ctx.fn.fneg(evalNumber(expr.operand, ctx));
        case "pos":
          return evalNumber(expr.operand, ctx); // unary + on a number is identity
        case "bnot":
          // ~a = ToInt32(a) ^ -1, back to double.
          return ctx.fn.sitofp(ctx.fn.ixor(toInt32(expr.operand, ctx), imm(T.i32, -1)));
        default:
          return ice(`evalNumber: unhandled unary op ${op} in number domain`);
      }
    }

    case "binary":
      return evalArithOrBitwise(expr, ctx);

    case "boolLit":
    case "stringLit":
      return ice(`evalNumber: got a ${expr.kind} in the number domain`);

    default:
      return ice(`evalNumber: unhandled expression ${(expr as { kind: string }).kind}`);
  }
}

// A number-typed binary op: floating arithmetic, or JS int32 bitwise/shift.
function evalArithOrBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  switch (expr.op) {
    case "add":
      return ctx.fn.fadd(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "sub":
      return ctx.fn.fsub(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "mul":
      return ctx.fn.fmul(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "div":
      return ctx.fn.fdiv(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    case "rem":
      return ctx.fn.frem(evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
    default:
      return evalBitwise(expr, ctx);
  }
}

// JS int32 bitwise/shift ops. Both operands go through ToInt32; shifts mask the count to 5
// bits; the result reinterprets the 32 bits back to a double (signed, except `>>>` unsigned).
function evalBitwise(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const ai = toInt32(expr.left, ctx);
  const bi = toInt32(expr.right, ctx);
  const count = () => ctx.fn.iand(bi, imm(T.i32, 31)); // JS masks shift count to 0..31
  switch (expr.op) {
    case "band":
      return ctx.fn.sitofp(ctx.fn.iand(ai, bi));
    case "bor":
      return ctx.fn.sitofp(ctx.fn.ior(ai, bi));
    case "bxor":
      return ctx.fn.sitofp(ctx.fn.ixor(ai, bi));
    case "shl":
      return ctx.fn.sitofp(ctx.fn.shl(ai, count()));
    case "shr":
      return ctx.fn.sitofp(ctx.fn.ashr(ai, count())); // arithmetic (sign-propagating)
    case "ushr":
      return ctx.fn.uitofp(ctx.fn.lshr(ai, count())); // logical; result is unsigned
    default:
      return ice(`evalBitwise: not a bitwise op: ${expr.op}`);
  }
}

// ToInt32(expr): evaluate to a double, then coerce via the runtime helper to an i32.
function toInt32(expr: HExpr, ctx: Ctx): Value {
  return ctx.fn.call("@cs_to_int32", T.i32, [evalNumber(expr, ctx)]);
}

// JS truthiness of an expression → i1 (evaluates the expression once).
export function toBool(expr: HExpr, ctx: Ctx): Value {
  return truthyOfValue(evalValue(expr, ctx), expr.type, ctx);
}

// JS truthiness of an ALREADY-computed Value → i1. Used where re-evaluating the expression
// would repeat side effects (e.g. the left operand of &&/||). Matches JS: number truthy iff
// != 0 and not NaN (ordered `one` vs 0 is false for both 0 and NaN); boolean is itself.
export function truthyOfValue(v: Value, vt: ValueType, ctx: Ctx): Value {
  switch (vt.kind) {
    case "boolean":
      return v;
    case "number":
      return ctx.fn.fcmp("one", v, fimm(0));
    case "string": {
      // JS: a string is truthy iff its length > 0 (only "" is falsy). cs_str_len is byte length,
      // ASCII-exact per the subset; NUL bytes count, so "\0" is truthy — matching Node.
      const len = ctx.fn.call("@cs_str_len", T.i32, [v]);
      return ctx.fn.icmp("ne", len, imm(T.i32, 0));
    }
    default:
      return ice(`truthiness: ${vt.kind} not supported yet`);
  }
}

// Short-circuiting `&&` / `||` with JS value semantics: the result is one of the operands.
// Implemented with a result slot (mem2reg promotes it to a phi at -O2), so the right operand
// is evaluated only when the left doesn't decide the outcome.
export function evalLogical(expr: Extract<HExpr, { kind: "logical" }>, ctx: Ctx): Value {
  const irt = irTypeOf(expr.type);
  const slot = ctx.fn.alloca(irt);
  const leftVal = evalValue(expr.left, ctx);
  ctx.fn.store(leftVal, slot); // default result = left
  const leftTruthy = truthyOfValue(leftVal, expr.left.type, ctx);

  const rightB = ctx.fn.newBlock("logic.right");
  const doneB = ctx.fn.newBlock("logic.done");
  // `&&`: evaluate right only if left is truthy. `||`: only if left is falsy.
  if (expr.op === "and") ctx.fn.brCond(leftTruthy, rightB, doneB);
  else ctx.fn.brCond(leftTruthy, doneB, rightB);

  ctx.fn.switchTo(rightB);
  ctx.fn.store(evalValue(expr.right, ctx), slot); // result = right
  ctx.fn.br(doneB);

  ctx.fn.switchTo(doneB);
  return ctx.fn.load(irt, slot);
}

// `Number(x)`: number → identity; boolean → 1/0; string → the ECMAScript StringToNumber parse.
function evalNumberConvert(value: HExpr, ctx: Ctx): Value {
  switch (value.type.kind) {
    case "number":
      return evalNumber(value, ctx);
    case "boolean":
      return ctx.fn.uitofp(ctx.fn.zextI1ToI32(evalBool(value, ctx)));
    case "string":
      return ctx.fn.call("@cs_string_to_number", T.double, [evalString(value, ctx)]);
    default:
      return ice(`Number(): conversion from ${value.type.kind} not supported yet`);
  }
}

// `Boolean(x)`: JS truthiness. number → not NaN and not 0 (`fcmp one` is ordered, so NaN→false);
// string → non-empty; boolean → identity.
function evalBooleanConvert(value: HExpr, ctx: Ctx): Value {
  switch (value.type.kind) {
    case "boolean":
      return evalBool(value, ctx);
    case "number":
      return ctx.fn.fcmp("one", evalNumber(value, ctx), fimm(0));
    case "string":
      return ctx.fn.icmp(
        "ne",
        ctx.fn.call("@cs_str_len", T.i32, [evalString(value, ctx)]),
        imm(T.i32, 0),
      );
    default:
      return ice(`Boolean(): conversion from ${value.type.kind} not supported yet`);
  }
}

// Evaluate a boolean-typed HExpr to an i1 Value.
export function evalBool(expr: HExpr, ctx: Ctx): Value {
  switch (expr.kind) {
    case "boolLit":
      return imm(T.i1, expr.value ? 1 : 0);

    case "varRef":
      return ctx.fn.load(T.i1, lookupVar(expr.name, ctx).ptr);

    case "call":
      return evalCall(expr, ctx);

    case "logical":
      return evalLogical(expr, ctx);

    case "unary":
      // Only `!` produces a boolean here (neg/pos live in the number domain).
      if (expr.op === "not") return ctx.fn.logicalNot(toBool(expr.operand, ctx));
      return ice(`evalBool: unary op ${expr.op} does not produce a boolean`);

    case "binary":
      return evalComparison(expr, ctx);

    case "memberGet":
      return evalMemberGet(expr, ctx);

    case "strMethod":
      return evalStrMethod(expr, ctx);

    case "coalesce":
      return evalCoalesce(expr, ctx);

    case "unwrap":
      return evalUnwrap(expr, ctx);

    case "nullCheck":
      return evalNullCheck(expr, ctx);

    case "arraySearch":
      return evalArraySearch(expr.array, expr.value, expr.elementType, expr.wantIndex, ctx);

    case "callClosure":
      return evalCallClosure(expr, ctx);

    case "virtualCall":
      return evalVirtualCall(expr, ctx);

    case "conditional":
      return evalConditional(expr, ctx);

    case "arrayHof":
      return evalArrayHof(expr, ctx); // .some()/.every() → boolean

    case "mapHas":
      return ctx.fn.icmp(
        "ne",
        ctx.fn.call("@cs_map_has", T.i32, [
          evalMapPtr(expr.map, ctx),
          boxSlot(evalValue(expr.key, ctx), expr.key.type, ctx),
          imm(T.i32, expr.keyKind),
        ]),
        imm(T.i32, 0),
      );

    case "mapDelete":
      return ctx.fn.icmp(
        "ne",
        ctx.fn.call("@cs_map_delete", T.i32, [
          evalMapPtr(expr.map, ctx),
          boxSlot(evalValue(expr.key, ctx), expr.key.type, ctx),
          imm(T.i32, expr.keyKind),
        ]),
        imm(T.i32, 0),
      );

    case "setHas":
      return evalSetPredicate("@cs_set_has", expr, ctx);

    case "setDelete":
      return evalSetPredicate("@cs_set_delete", expr, ctx);

    case "convert": // `Boolean(x)` — JS truthiness of the value.
      return evalBooleanConvert(expr.value, ctx);

    case "thrownIsError": // `e instanceof Error` on a caught value → the CsThrown's isError tag.
      return ctx.fn.icmp(
        "ne",
        ctx.fn.call("@cs_thrown_is_error", T.i32, [evalValue(expr.value, ctx)]),
        imm(T.i32, 0),
      );

    case "instanceofCheck": {
      // The receiver's vtable pointer (record slot 0) equals the target class's or any subclass's.
      if (expr.value.type.kind !== "object") {
        return ice(`instanceof on ${expr.value.type.kind} not supported yet`);
      }
      const obj = evalObjectPtr(expr.value, ctx);
      const vtbl = ctx.fn.load(T.i64, ctx.fn.gepSlot(obj, 0));
      let acc: Value | null = null;
      for (const name of expr.vtableClasses) {
        const eq = ctx.fn.icmp("eq", vtbl, ctx.fn.ptrToI64(ctx.mod.vtableAddr(name)));
        acc = acc === null ? eq : ctx.fn.logicalOr(acc, eq);
      }
      return acc ?? imm(T.i1, 0);
    }

    default:
      return ice(`evalBool: unhandled boolean expression ${expr.kind}`);
  }
}

function evalComparison(expr: Extract<HExpr, { kind: "binary" }>, ctx: Ctx): Value {
  const op = expr.op;
  const relPred = RELATIONAL[op];
  if (relPred) {
    // String relational operands are gated OUT of the subset at validate (CS1216): byte-order
    // comparison diverges from Node's UTF-16 code-unit order on non-ASCII. Only numbers reach here.
    // Ordered predicate → NaN yields false, matching JS.
    return ctx.fn.fcmp(relPred, evalNumber(expr.left, ctx), evalNumber(expr.right, ctx));
  }
  if (op === "eq" || op === "ne") {
    const operandType = expr.left.type.kind;
    // Optional vs concrete (`str.at(i) !== "h"`). One side is `T | undefined`, the other a plain
    // inner value. Both-optional isn't emitted by the fixtures yet — leave it to the loud default.
    const rightOpt = expr.right.type.kind === "optional";
    if ((operandType === "optional") !== rightOpt) {
      const optExpr = operandType === "optional" ? expr.left : expr.right;
      const otherExpr = operandType === "optional" ? expr.right : expr.left;
      return evalOptionalEquality(optExpr, otherExpr, op === "ne", ctx);
    }
    if (operandType === "number") {
      // === → oeq (NaN===NaN false); !== → une (= !oeq, so NaN!==NaN true). Using ordered
      // `one` for !== would wrongly make NaN!==NaN false — a JS divergence.
      return ctx.fn.fcmp(
        op === "eq" ? "oeq" : "une",
        evalNumber(expr.left, ctx),
        evalNumber(expr.right, ctx),
      );
    }
    if (operandType === "boolean") {
      return ctx.fn.icmp(
        op === "eq" ? "eq" : "ne",
        evalBool(expr.left, ctx),
        evalBool(expr.right, ctx),
      );
    }
    if (operandType === "string") {
      // Value-position `===`/`!==` on strings: cs_str_eq returns 1 when equal (length + bytes,
      // NUL-safe — same primitive `switch` uses). `eq` is true when cs_str_eq != 0; `ne` inverts.
      const cmp = ctx.fn.call("@cs_str_eq", T.i32, [
        evalString(expr.left, ctx),
        evalString(expr.right, ctx),
      ]);
      return ctx.fn.icmp(op === "eq" ? "ne" : "eq", cmp, imm(T.i32, 0));
    }
    return ice(`evalBool: ${op} on ${operandType} operands not supported yet`);
  }
  return ice(`evalBool: binary op ${op} is not a comparison`);
}
