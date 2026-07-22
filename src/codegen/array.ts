// Array higher-order methods (map/filter/forEach/reduce/find/findIndex/some/every/flatMap) and
// sort — each lowered to an inline IR loop. Split out of expr.ts; the generic evaluators and array
// helpers are imported back (circular, resolved at call time).

import { ice } from "../diagnostics.js";
import { fimm, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  type Ctx,
  irTypeOf,
  evalArrayPtr,
  evalFunctionPtr,
  evalValue,
  evalString,
  unboxSlot,
  boxSlot,
  arrayElementAt,
  emitStrictEq,
  coerceValueToString,
} from "./expr.js";

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
