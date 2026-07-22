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
import { evalArrayHof, evalArraySort, evalArraySearch, evalArrayJoin } from "./array.js";
import { evalObjectPtr, evalMemberGet, headerOffset } from "./objects.js";
import { evalAsyncCall, evalAwait, evalPromiseResolve, evalPromiseAll } from "./async.js";
import { evalNumber } from "./numbers.js";
import {
  evalOptionalPtr,
  evalCoalesce,
  evalUnwrap,
  evalNullCheck,
  evalOptionalEquality,
} from "./optional.js";

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
  // Set while emitting an `async function` body: `return v` resolves the fiber's promise via
  // cs_fiber_return(boxSlot(v)) instead of an ordinary `ret`, and the LLVM function returns void.
  asyncFn?: boolean;
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
    case "promise":
      return ctx.fn.i64ToPtr(slot);
    case "boolean":
      return ctx.fn.truncI64ToI1(slot);
    default:
      return ice(`slot unboxing not supported for ${elemType.kind} yet`);
  }
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
  // `await` yields its inner-typed value; handle before the type switch so it dispatches by result
  // type regardless (a number `await`, a string `await`, …).
  if (expr.kind === "await") return evalAwait(expr, ctx);
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
    case "promise":
      if (expr.kind === "asyncCall") return evalAsyncCall(expr, ctx);
      if (expr.kind === "promiseResolve") return evalPromiseResolve(expr, ctx);
      if (expr.kind === "promiseAll") return evalPromiseAll(expr, ctx);
      if (expr.kind === "varRef") return ctx.fn.load(T.ptr, lookupVar(expr.name, ctx).ptr);
      return ice(`evalValue: promise expression ${expr.kind} not supported yet`);
    default:
      return ice(`evalValue: ${expr.type.kind} not supported yet`);
  }
}

// Evaluate a string-typed HExpr to a ptr Value (cstring for a literal; a load for a varRef).
export function evalString(expr: HExpr, ctx: Ctx): Value {
  if (expr.kind === "await") return evalAwait(expr, ctx);
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
export function evalNumberConvert(value: HExpr, ctx: Ctx): Value {
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
  if (expr.kind === "await") return evalAwait(expr, ctx);
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
