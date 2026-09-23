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
import type { HExpr, BinaryOp, ShapeDescriptor } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { evalMathCall } from "./math.js";
import {
  evalCollectionForEach,
  evalMapPtr,
  evalMapGet,
  evalSetPtr,
  evalSetPredicate,
} from "./collections.js";
import { evalStrMethod } from "./strings.js";
import {
  evalArrayHof,
  evalArraySort,
  evalArraySearch,
  evalArrayJoin,
  arrayJoinValue,
} from "./array.js";
import { evalObjectPtr, evalMemberGet, evalObjectValues } from "./objects.js";
import { loadShape, shapeRef } from "./shapes.js";
// Method calls live in methods.ts; re-exported for the evaluators that dispatch to them.
import { evalVirtualCall, evalVirtualCallStmt } from "./methods.js";
export { evalVirtualCall, evalVirtualCallStmt };
import { evalAsyncCall, evalAwait, evalPromiseResolve, evalPromiseAll } from "./async.js";
import { jsonStringify } from "./json.js";
import { jsonParse } from "./json-parse.js";
import { evalClosure } from "./cells.js";
import { evalAdaptClosure, evalConvertArray } from "./generics.js";
import { evalNumber } from "./numbers.js";
import {
  evalValueWord,
  evalUnbox,
  evalTypeOf,
  evalTypeIs,
  evalInstanceof,
  valueStrictEq,
  valueToString,
} from "./value-ops.js";
// Truthiness-based evaluation lives in truthiness.ts; re-exported so the existing import sites
// (codegen.ts, numbers.ts) keep resolving through expr.ts.
import {
  toBool,
  truthyOfValue,
  evalLogical,
  evalNumberConvert,
  evalBooleanConvert,
} from "./truthiness.js";
export { toBool, truthyOfValue, evalLogical, evalNumberConvert, evalBooleanConvert };
import { evalOptionalPtr, evalCoalesce, evalUnwrap, evalNullCheck } from "./optional.js";
import { emitStrictEq, evalComparison } from "./equality.js";
export { emitStrictEq };

export interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
  // Live variable slots: name → its stack pointer + resolved type. A `cell` variable's stack slot
  // holds the pointer to its heap cell (codegen/cells.ts); lookupVar returns the cell itself.
  vars: Map<string, { ptr: Value; vtype: ValueType; cell?: true }>;
  // Module-scope bindings (top-level `let`/`const`), shared by every function. These live in
  // `internal global`s rather than main's frame precisely because functions must reach them.
  globals: Map<string, { ptr: Value; vtype: ValueType }>;
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
  // Set while emitting an `async function` body: `return v` resolves the fiber's promise via
  // cs_fiber_return(boxSlot(v)) instead of an ordinary `ret`, and the LLVM function returns void.
  asyncFn?: boolean;
  // The program's allocation layouts (HModule.shapes), indexed by shape id.
  shapes: readonly ShapeDescriptor[];
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
    case "promise":
      return T.ptr; // pointer to a runtime Promise
    case "opaque":
      return T.ptr; // an opaque runtime handle (setTimeout's Timeout)
    case "value":
      return T.i64; // a self-describing Value word (value.ts)
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
    case "promise":
    case "opaque":
      return ctx.fn.ptrToI64(v); // all pointer-represented
    case "boolean":
      return ctx.fn.zextI1ToI64(v);
    case "value":
      return v; // a Value word already is a slot
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
    case "promise":
    case "opaque":
      return ctx.fn.i64ToPtr(slot);
    case "boolean":
      return ctx.fn.truncI64ToI1(slot);
    case "value":
      return slot;
    default:
      return ice(`slot unboxing not supported for ${elemType.kind} yet`);
  }
}

// Evaluate an array-typed HExpr to a ptr (to the runtime array struct).
export function evalArrayPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "await") return evalAwait(expr, ctx);
  switch (expr.kind) {
    case "unbox":
      return evalUnbox(expr, ctx);
    case "convertArray":
      return evalConvertArray(expr, ctx);
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
    case "runtimeCall":
      // An array-returning runtime entry (process.argv.slice(2)).
      return ctx.fn.call(
        `@${expr.fn}`,
        T.ptr,
        expr.args.map((a) => evalValue(a, ctx)),
      );
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
    case "objectValues":
      return evalObjectValues(expr, ctx);
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

// Coerce an already-computed Value to its JS string form (a ptr), per its type.
export function coerceValueToString(v: Value, type: ValueType, ctx: Ctx): Value {
  switch (type.kind) {
    case "string":
      return v;
    case "number":
      return ctx.fn.call("@cs_num_to_string", T.ptr, [v]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(v)]);
    case "value":
      return valueToString(v, type, ctx);
    case "unknown":
      // A caught value or an Error: "Error: <msg>" / "TypeError: <msg>", or the thrown string.
      return ctx.fn.call("@cs_thrown_to_string", T.ptr, [v]);
    case "array":
      // Array.prototype.toString is join(","): nested arrays flatten, nullish elements join as "".
      return arrayJoinValue(v, type.element, ctx.mod.cstring(","), ctx);
    // Object.prototype.toString. lower turns an object whose own class defines toString() into a
    // call to it, and the validator (string-rules.ts) rejects the conversions where some object
    // reaching this site defines its own toString or valueOf, so every record here uses the default.
    case "object":
      return ctx.mod.cstring("[object Object]");
    case "map":
      return ctx.mod.cstring("[object Map]");
    case "set":
      return ctx.mod.cstring("[object Set]");
    case "promise":
      return ctx.mod.cstring("[object Promise]");
    case "optional":
      return optionalPtrToString(v, type.inner, ctx);
    case "null":
    case "undefined":
      return ctx.mod.cstring(type.kind);
    case "function":
    case "opaque":
      // Node prints a function's source text and a Timeout's id; string-rules.ts rejects both.
      return ice(`coerceValueToString: ${type.kind} has no string form`);
    default: {
      const never: never = type;
      return ice(`coerceValueToString: ${(never as ValueType).kind}`);
    }
  }
}

export function lookupVar(name: string, ctx: Ctx): { ptr: Value; vtype: ValueType } {
  // Locals shadow nothing here — names are already symbol-unique — but locals are checked first
  // because they are by far the common case.
  const slot = ctx.vars.get(name) ?? ctx.globals.get(name);
  if (!slot) ice(`codegen: reference to unbound variable ${name}`);
  // The cell pointer is reloaded at every use: a per-iteration loop binding swaps it (cells.ts).
  if ("cell" in slot) return { ptr: ctx.fn.load(T.ptr, slot.ptr), vtype: slot.vtype };
  return slot;
}

// A value-returning call: evaluate each argument to a Value, then call. The callee's IR name
// is its HIR name; the return IR type comes from the call's resolved (non-void) type.
export function evalCall(expr: Extract<HExpr, { kind: "call" }>, ctx: Ctx): Value {
  const args = expr.args.map((a) => evalValue(a, ctx));
  return ctx.fn.call(`@${expr.name}`, irTypeOf(expr.type), args);
}

// Evaluate a function-typed HExpr to a closure-record pointer.
export function evalFunctionPtr(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "await") return evalAwait(expr, ctx);
  if (expr.kind === "closure") return evalClosure(expr, ctx);
  if (expr.kind === "adaptClosure") return evalAdaptClosure(expr, ctx);
  if (expr.kind === "unbox") return evalUnbox(expr, ctx);
  if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
  if (expr.kind === "call") return evalCall(expr, ctx);
  if (expr.kind === "callClosure") return evalCallClosure(expr, ctx);
  if (expr.kind === "virtualCall") return evalVirtualCall(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  if (expr.kind === "unwrap") return evalUnwrap(expr, ctx);
  if (expr.kind === "memberGet") return evalMemberGet(expr, ctx);
  if (expr.kind === "coalesce") return evalCoalesce(expr, ctx);
  return ice(`evalFunctionPtr: unhandled function expression ${expr.kind}`);
}

// Call a closure value: load its fnptr + env and invoke fnptr(env, args...).
export function evalCallClosure(expr: Extract<HExpr, { kind: "callClosure" }>, ctx: Ctx): Value {
  const rec = evalValue(expr.callee, ctx);
  const fnptr = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(rec, 0)));
  const env = ctx.fn.i64ToPtr(ctx.fn.load(T.i64, ctx.fn.gepSlot(rec, 1)));
  const args = [env, ...expr.args.map((a) => evalValue(a, ctx))];
  return ctx.fn.callIndirect(fnptr, irTypeOf(expr.type), args);
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
  if (expr.kind === "jsonParse") {
    return jsonParse(
      evalString(expr.text, ctx),
      expr.type,
      expr.objectShapes,
      expr.dynamicShape,
      ctx,
    );
  }
  if (expr.kind === "arrayHof") return evalArrayHof(expr, ctx);
  if (expr.kind === "collectionForEach") return evalCollectionForEach(expr, ctx);
  if (expr.kind === "conditional") return evalConditional(expr, ctx);
  if (expr.kind === "unwrap") return evalUnwrap(expr, ctx);
  if (expr.kind === "memberGet") return evalMemberGet(expr, ctx);
  if (expr.kind === "coalesce") return evalCoalesce(expr, ctx);
  // `await` yields its inner-typed value; handle before the type switch so it dispatches by result
  // type regardless (a number `await`, a string `await`, …).
  if (expr.kind === "await") return evalAwait(expr, ctx);
  if (expr.kind === "unbox") return evalUnbox(expr, ctx);
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
    case "opaque":
      // Only two forms reach here — the runtime call that MINTS the handle, and a read of the
      // variable holding it. The validator (CS1234) rejects every other use, so anything else
      // arriving is a compiler bug rather than a user error.
      if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
      if (expr.kind === "runtimeCall") {
        return ctx.fn.call(
          `@${expr.fn}`,
          T.ptr,
          expr.args.map((a) => evalValue(a, ctx)),
        );
      }
      return ice(`evalValue: opaque expression ${expr.kind}`);
    case "value":
      return evalValueWord(expr, ctx);
    case "promise":
      if (expr.kind === "asyncCall") return evalAsyncCall(expr, ctx);
      if (expr.kind === "promiseResolve") return evalPromiseResolve(expr, ctx);
      if (expr.kind === "promiseAll") return evalPromiseAll(expr, ctx);
      if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
      // `node:fs/promises` entries: the runtime returns an already-created Promise* whose
      // settlement the event loop delivers later.
      if (expr.kind === "runtimeCall") {
        return ctx.fn.call(
          `@${expr.fn}`,
          T.ptr,
          expr.args.map((a) => evalValue(a, ctx)),
        );
      }
      return ice(`evalValue: promise expression ${expr.kind} not supported yet`);
    default:
      return ice(`evalValue: ${expr.type.kind} not supported yet`);
  }
}

// Evaluate a string-typed HExpr to a ptr Value (cstring for a literal; a load for a varRef).
export function evalString(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "await") return evalAwait(expr, ctx);
  if (expr.kind === "jsonStringify") {
    const indent = expr.indent === null ? ctx.fn.nullPtr() : ctx.mod.cstring(expr.indent);
    const v = evalValue(expr.value, ctx);
    return jsonStringify(v, expr.value.type, ctx, indent, imm(T.i32, 0));
  }
  switch (expr.kind) {
    case "stringLit":
      return ctx.mod.cstring(expr.value);
    case "varRef":
      return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
    case "runtimeCall":
      // A string-returning runtime entry (fs.readFileSync).
      return ctx.fn.call(
        `@${expr.fn}`,
        T.ptr,
        expr.args.map((a) => evalValue(a, ctx)),
      );
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
    case "typeOf":
      return evalTypeOf(expr.value, ctx);
    case "unbox":
      return evalUnbox(expr, ctx);
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
    case "null":
      return ctx.mod.cstring("null");
    case "undefined":
      return ctx.mod.cstring("undefined");
    case "optional":
      return optionalPtrToString(evalOptionalPtr(expr, ctx), expr.type.inner, ctx);
    case "value":
      return valueToString(evalValueWord(expr, ctx), expr.type, ctx);
    default:
      return coerceValueToString(evalValue(expr, ctx), expr.type, ctx);
  }
}

// String coercion of a `T | null | undefined`: JS spells the absent cases "undefined"/"null" and
// coerces a present value by its inner type. Branches on the two nullish sentinels at runtime.
function optionalPtrToString(opt: Value, inner: ValueType, ctx: Ctx): Value {
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

// Evaluate a boolean-typed HExpr to an i1 Value.
export function evalBool(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "await") return evalAwait(expr, ctx);
  switch (expr.kind) {
    case "boolLit":
      return imm(T.i1, expr.value ? 1 : 0);

    case "runtimeCall": {
      // A predicate runtime entry (fs.existsSync) answers i32 0/1, like every other C boolean.
      const r = ctx.fn.call(
        `@${expr.fn}`,
        T.i32,
        expr.args.map((a) => evalValue(a, ctx)),
      );
      return ctx.fn.icmp("ne", r, imm(T.i32, 0));
    }

    case "numberPredicate": {
      const x = evalNumber(expr.arg, ctx);
      // isNaN: unordered self-compare is true ONLY for NaN.
      if (expr.fn === "isNaN") return ctx.fn.fcmp("uno", x, x);
      // isFinite: x-x is 0 for finite, NaN for ±Infinity, NaN for NaN — so ordered `== 0` iff finite.
      const finite = ctx.fn.fcmp("oeq", ctx.fn.fsub(x, x), fimm(0));
      if (expr.fn === "isFinite") return finite;
      // isInteger: finite AND floor(x) === x (the finite guard rejects ±Infinity, whose floor is
      // itself). `select` gives the short-circuit AND without an i1 bitwise op.
      const floorEq = ctx.fn.fcmp("oeq", ctx.fn.call("@floor", T.double, [x]), x);
      return ctx.fn.select(finite, floorEq, imm(T.i1, 0));
    }

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

    case "typeIs":
      return evalTypeIs(expr.value, expr.test, ctx);

    case "unbox":
      return evalUnbox(expr, ctx);

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

    case "instanceofCheck":
      return evalInstanceof(expr, ctx);

    default:
      return ice(`evalBool: unhandled boolean expression ${expr.kind}`);
  }
}
