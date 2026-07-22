// Backend: HIR → LLVM IR. Consumes HModule only. This module (and everything under codegen/)
// MUST NOT import `typescript` or touch the checker — the type wall is enforced by
// tests/unit/architecture.test.ts. All type decisions were made in lower/ and are recorded on
// the HIR nodes; here we only translate. An unhandled shape is an ICE (loud), never silent IR.
//
// TO EXTEND: add a case here for a new HIR node, add the node in hir/, and lower it in lower/.
// Never reach back to the AST or checker from this file.

import { ice } from "../diagnostics.js";
import { ModuleBuilder, imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HModule, HStmt, HExpr, HFunc } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import {
  evalNumber,
  evalBool,
  evalString,
  evalValue,
  evalArrayPtr,
  arrayElementAt,
  boxSlot,
  emitStrictEq,
  irTypeOf,
  lookupVar,
  toBool,
  evalVirtualCall,
  evalVirtualCallStmt,
  type Ctx,
  type TryFrame,
  type LoopTarget,
} from "./expr.js";
import { evalObjectPtr, headerOffset } from "./objects.js";
import { evalOptionalPtr, unboxOptionalValue, unboxSlotValue } from "./optional.js";
import { inspect } from "./inspect.js";

export function generate(hmod: HModule): string {
  const mod = new ModuleBuilder();
  mod.declareExtern("cs_print_cstr", T.void, [T.ptr]);
  mod.declareExtern("cs_print_f64", T.void, [T.double]);
  mod.declareExtern("cs_print_bool", T.void, [T.i32]);
  mod.declareExtern("cs_print_space", T.void, []);
  mod.declareExtern("cs_print_newline", T.void, []);
  mod.declareExtern("cs_to_int32", T.i32, [T.double]); // ECMAScript ToInt32 for bitwise ops
  mod.declareExtern("cs_str_concat", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_num_to_string", T.ptr, [T.double]);
  mod.declareExtern("cs_num_to_string_radix", T.ptr, [T.double, T.double]);
  mod.declareExtern("cs_string_to_number", T.double, [T.ptr]);
  mod.declareExtern("cs_inspect_num", T.ptr, [T.double]);
  mod.declareExtern("cs_inspect_str", T.ptr, [T.ptr]);
  mod.declareExtern("cs_bool_to_string", T.ptr, [T.i32]);
  mod.declareExtern("cs_str_eq", T.i32, [T.ptr, T.ptr]);
  // Math.* : libm (double→double) + JS-semantics helpers.
  for (const f of ["floor", "ceil", "trunc", "sqrt", "fabs", "cs_math_round", "cs_math_sign"]) {
    mod.declareExtern(f, T.double, [T.double]);
  }
  mod.declareExtern("pow", T.double, [T.double, T.double]);
  mod.declareExtern("cs_math_max2", T.double, [T.double, T.double]);
  mod.declareExtern("cs_math_min2", T.double, [T.double, T.double]);
  // String methods.
  mod.declareExtern("cs_str_len", T.i32, [T.ptr]);
  for (const f of [
    "cs_str_upper",
    "cs_str_lower",
    "cs_str_trim",
    "cs_str_trim_start",
    "cs_str_trim_end",
  ]) {
    mod.declareExtern(f, T.ptr, [T.ptr]);
  }
  mod.declareExtern("cs_str_repeat", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_char_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_slice1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_slice2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_substr", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_substring1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_substring2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_pad_start", T.ptr, [T.ptr, T.double, T.ptr]);
  mod.declareExtern("cs_str_pad_end", T.ptr, [T.ptr, T.double, T.ptr]);
  mod.declareExtern("cs_str_replace", T.ptr, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_str_replaceAll", T.ptr, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_str_split", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_parse_int", T.double, [T.ptr, T.double]);
  mod.declareExtern("cs_parse_float", T.double, [T.ptr]);
  mod.declareExtern("cs_str_index_of", T.double, [T.ptr, T.ptr, T.double]);
  mod.declareExtern("cs_str_last_index_of", T.double, [T.ptr, T.ptr, T.double]);
  // All three take an optional position/endPosition (double); codegen passes the arg or a default.
  for (const f of ["cs_str_includes", "cs_str_starts_with", "cs_str_ends_with"]) {
    mod.declareExtern(f, T.i32, [T.ptr, T.ptr, T.double]);
  }
  mod.declareExtern("cs_gc_init", T.void, []);
  mod.declareExtern("cs_gc_alloc", T.ptr, [T.i64]);
  mod.declareExtern("cs_array_new", T.ptr, []);
  mod.declareExtern("cs_array_push", T.i32, [T.ptr, T.i64]);
  mod.declareExtern("cs_array_len", T.i32, [T.ptr]);
  mod.declareExtern("cs_array_get", T.i64, [T.ptr, T.i32]);
  mod.declareExtern("cs_array_pop", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_shift", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_reverse", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_slice1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_array_slice2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_array_concat", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_array_set", T.void, [T.ptr, T.i32, T.i64]);
  mod.declareExtern("cs_array_extend", T.void, [T.ptr, T.ptr]);
  mod.declareExtern("cs_array_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_array_flat", T.ptr, [T.ptr]);
  mod.declareExtern("cs_str_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_cmp", T.i32, [T.ptr, T.ptr]);
  // Map: keys/values cross as i64 slots; `kind` (i32) selects key equality.
  mod.declareExtern("cs_map_new", T.ptr, []);
  mod.declareExtern("cs_map_set", T.void, [T.ptr, T.i64, T.i64, T.i32]);
  mod.declareExtern("cs_map_get", T.ptr, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_has", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_delete", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_size", T.i32, [T.ptr]);
  mod.declareExtern("cs_map_keys", T.ptr, [T.ptr]);
  mod.declareExtern("cs_map_values", T.ptr, [T.ptr]);
  mod.declareExtern("cs_set_new", T.ptr, []);
  mod.declareExtern("cs_set_from_array", T.ptr, [T.ptr, T.i32]);
  mod.declareExtern("cs_set_add", T.void, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_has", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_delete", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_size", T.i32, [T.ptr]);
  mod.declareExtern("cs_set_values", T.ptr, [T.ptr]);
  mod.declareExtern("exit", T.void, [T.i32]);
  mod.declareExtern("cs_throw", T.void, [T.ptr]);
  mod.declareExtern("cs_handler_alloc", T.ptr, []);
  mod.declareExtern("cs_push_handler", T.void, [T.ptr]);
  mod.declareExtern("cs_pop_handler", T.void, []);
  mod.declareExtern("_setjmp", T.i32, [T.ptr], "returns_twice");
  mod.declareExtern("cs_handler_thrown", T.ptr, [T.ptr]);
  mod.declareExtern("cs_handler_count", T.i32, []);
  mod.declareExtern("cs_handler_restore", T.void, [T.i32]);
  mod.declareExtern("cs_new_error", T.ptr, [T.ptr]);
  mod.declareExtern("cs_new_thrown_str", T.ptr, [T.ptr]);
  mod.declareExtern("cs_thrown_is_error", T.i32, [T.ptr]);
  mod.declareExtern("cs_thrown_to_string", T.ptr, [T.ptr]);

  // Class vtables (constant arrays of method fn pointers); an instance stores a pointer to its
  // class's vtable in record slot 0 for virtual dispatch.
  for (const c of hmod.classes) mod.defineVtable(c.name, c.vtable);

  // User functions first (order doesn't matter — LLVM resolves calls by name, so recursion and
  // mutual recursion just work).
  for (const f of hmod.functions) emitFunction(f, mod);

  // The synthesized entry function holds the top-level statements.
  const main = mod.defineFunc("main", T.i32, []);
  const ctx: Ctx = {
    mod,
    fn: main,
    vars: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
    fnReturnType: null,
  };
  ctx.fn.callVoid("@cs_gc_init", []); // start Boehm GC before any allocation
  emitStatements(hmod.topLevel, ctx);
  main.ret(imm(T.i32, 0));
  return mod.render();
}

// Emit a statement list, stopping as soon as the current block is terminated (by a return,
// break, or continue). The remaining statements are unreachable, and emitting into a terminated
// block is an ICE — so this is how dead code after a jump is correctly dropped.
function emitStatements(stmts: HStmt[], ctx: Ctx): void {
  for (const s of stmts) {
    if (ctx.fn.currentBlock.isTerminated) return;
    emitStatement(s, ctx);
  }
}

function emitFunction(f: HFunc, mod: ModuleBuilder): void {
  const retType = f.returnType ? irTypeOf(f.returnType) : T.void;
  const captures = f.captures ?? [];
  // EVERY lambda (a function with a `captures` list, even empty) takes a hidden `env` pointer as
  // its first LLVM parameter, because callClosure always passes one. Top-level functions
  // (captures === undefined) do not.
  const hasEnv = f.captures !== undefined;
  const declaredParams: Value[] = f.params.map((p, i) => ({
    name: `%arg${hasEnv ? i + 1 : i}`,
    type: irTypeOf(p.type),
  }));
  const irParams: Value[] = hasEnv
    ? [{ name: "%arg0", type: T.ptr }, ...declaredParams]
    : declaredParams;
  const fn = mod.defineFunc(f.name, retType, irParams);
  const ctx: Ctx = {
    mod,
    fn,
    vars: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
    fnReturnType: f.returnType,
  };

  // Bind captured variables from the env record (env is %arg0). Each is stored in a fresh local
  // slot so the body reads it like any variable.
  if (hasEnv) {
    const env = irParams[0]!;
    captures.forEach((c, i) => {
      const raw = fn.load(T.i64, fn.gepSlot(env, i));
      const ptr = fn.alloca(irTypeOf(c.type));
      fn.store(unboxSlotValue(raw, c.type, ctx), ptr);
      ctx.vars.set(c.name, { ptr, vtype: c.type });
    });
  }

  // Copy each declared parameter into a stack slot so it can be reassigned like any local (JS
  // allows reassigning parameters), and bind the name to that slot.
  f.params.forEach((p, i) => {
    const ptr = fn.alloca(irTypeOf(p.type));
    fn.store(declaredParams[i]!, ptr);
    ctx.vars.set(p.name, { ptr, vtype: p.type });
  });

  emitStatements(f.body, ctx);

  // Terminate any fall-through. tsc guarantees a non-void function returns on every reachable
  // path, so an un-terminated tail block is either the implicit end of a void function or a
  // genuinely-unreachable merge block.
  if (!fn.currentBlock.isTerminated) {
    if (f.returnType === null) fn.retVoid();
    else fn.unreachable();
  }
}

// Structured-completion codes routed through a try's cleanup (which runs `finally` and dispatches
// the pending completion). A break/continue carries the loop/switch it targets via the frame.
const C_NORMAL = 0;
const C_RETURN = 1;
const C_BREAK = 2;
const C_CONTINUE = 3;
const C_THROW = 4;

// Unified `try [catch] [finally]` with a structured-completion model. A throw is caught by a
// setjmp handler; return/break/continue inside route to the cleanup block (which restores the
// handler depth, runs finally, and dispatches). Cleanup handles NORMAL / RETURN / BREAK / CONTINUE
// / THROW; each abrupt completion chains through any enclosing finally before reaching its target.
function emitTryCatch(stmt: Extract<HStmt, { kind: "tryCatch" }>, ctx: Ctx): void {
  const hasCatch = stmt.catchBody !== null;
  const hasFinally = stmt.finallyBody !== null;

  const saved = ctx.fn.call("@cs_handler_count", T.i32, []); // handler depth to restore on any exit
  const codeSlot = ctx.fn.alloca(T.i32);
  ctx.fn.store(imm(T.i32, C_NORMAL), codeSlot);
  const retSlot = ctx.fnReturnType ? ctx.fn.alloca(irTypeOf(ctx.fnReturnType)) : null;
  const cleanupB = ctx.fn.newBlock("try.cleanup");
  const afterB = ctx.fn.newBlock("try.after");
  const frame: TryFrame = {
    code: codeSlot,
    retVal: retSlot,
    cleanupEntry: cleanupB,
    index: ctx.finallyStack.length,
    // The loop/switch a crossing break/continue targets (innermost at try entry).
    enclosingBreak: ctx.breakTargets[ctx.breakTargets.length - 1] ?? null,
    enclosingContinue: ctx.continueTargets[ctx.continueTargets.length - 1] ?? null,
  };

  // Outer handler: catches a throw from the try body (when there is no catch) or from the catch
  // body. It longjmps back to this setjmp.
  const outer = ctx.fn.call("@cs_handler_alloc", T.ptr, []);
  ctx.fn.callVoid("@cs_push_handler", [outer]);
  const ro = ctx.fn.call("@_setjmp", T.i32, [outer]);
  const bodyB = ctx.fn.newBlock("try.body");
  const excB = ctx.fn.newBlock("try.exc");
  ctx.fn.brCond(ctx.fn.icmp("eq", ro, imm(T.i32, 0)), bodyB, excB);

  ctx.fn.switchTo(bodyB);
  ctx.finallyStack.push(frame);
  if (hasCatch) {
    // Inner handler catches a throw from the try body → runs catch (still under the outer handler).
    const inner = ctx.fn.call("@cs_handler_alloc", T.ptr, []);
    ctx.fn.callVoid("@cs_push_handler", [inner]);
    const ri = ctx.fn.call("@_setjmp", T.i32, [inner]);
    const innerTryB = ctx.fn.newBlock("try.inner");
    const innerCatchB = ctx.fn.newBlock("try.catch");
    ctx.fn.brCond(ctx.fn.icmp("eq", ri, imm(T.i32, 0)), innerTryB, innerCatchB);
    ctx.fn.switchTo(innerTryB);
    emitStatements(stmt.tryBody, ctx);
    if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(cleanupB); // NORMAL completion
    ctx.fn.switchTo(innerCatchB);
    // Bind `catch (e)`: the caught CsThrown value is in the inner handler.
    if (stmt.catchParam !== null) {
      const slot = ctx.fn.alloca(T.ptr);
      ctx.fn.store(ctx.fn.call("@cs_handler_thrown", T.ptr, [inner]), slot);
      ctx.vars.set(stmt.catchParam, { ptr: slot, vtype: { kind: "unknown" } });
    }
    emitStatements(stmt.catchBody!, ctx);
    if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(cleanupB);
  } else {
    emitStatements(stmt.tryBody, ctx);
    if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(cleanupB);
  }
  ctx.finallyStack.pop();

  // A throw reached the outer handler → mark the completion and fall into cleanup (finally, then
  // re-raise).
  ctx.fn.switchTo(excB);
  ctx.fn.store(imm(T.i32, C_THROW), codeSlot);
  ctx.fn.br(cleanupB);

  // Cleanup: restore the handler depth, run finally (the frame is already popped, so a return in
  // finally chains outward / overrides), then dispatch the pending completion.
  ctx.fn.switchTo(cleanupB);
  ctx.fn.callVoid("@cs_handler_restore", [saved]);
  if (hasFinally) emitStatements(stmt.finallyBody!, ctx);
  if (!ctx.fn.currentBlock.isTerminated) {
    // Dispatch the pending completion. Cases NORMAL (→ after), RETURN, BREAK, CONTINUE, THROW.
    const code = ctx.fn.load(T.i32, codeSlot);
    const retB = ctx.fn.newBlock("try.ret");
    const breakB = ctx.fn.newBlock("try.break");
    const contB = ctx.fn.newBlock("try.cont");
    const throwB = ctx.fn.newBlock("try.throw");
    const d1 = ctx.fn.newBlock("try.d1");
    const d2 = ctx.fn.newBlock("try.d2");
    const d3 = ctx.fn.newBlock("try.d3");
    ctx.fn.brCond(ctx.fn.icmp("eq", code, imm(T.i32, C_RETURN)), retB, d1);
    ctx.fn.switchTo(d1);
    ctx.fn.brCond(ctx.fn.icmp("eq", code, imm(T.i32, C_BREAK)), breakB, d2);
    ctx.fn.switchTo(d2);
    ctx.fn.brCond(ctx.fn.icmp("eq", code, imm(T.i32, C_CONTINUE)), contB, d3);
    ctx.fn.switchTo(d3);
    ctx.fn.brCond(ctx.fn.icmp("eq", code, imm(T.i32, C_THROW)), throwB, afterB);

    ctx.fn.switchTo(retB);
    emitReturnCompletion(ctx, retSlot);
    ctx.fn.switchTo(breakB);
    emitLoopCompletion(ctx, frame, frame.enclosingBreak, C_BREAK);
    ctx.fn.switchTo(contB);
    emitLoopCompletion(ctx, frame, frame.enclosingContinue, C_CONTINUE);
    ctx.fn.switchTo(throwB);
    // Re-raise the value this try caught, reading it from the handler (not a global).
    ctx.fn.callVoid("@cs_throw", [ctx.fn.call("@cs_handler_thrown", T.ptr, [outer])]);
    ctx.fn.unreachable();
  }

  ctx.fn.switchTo(afterB);
}

// A break/continue completion at a cleanup dispatch: if there is still an enclosing finally
// between this try and the target loop/switch (frame is nested deeper than the target's finally
// depth), chain to that outer finally; otherwise jump to the target. Decided at compile time.
function emitLoopCompletion(
  ctx: Ctx,
  frame: TryFrame,
  target: LoopTarget | null,
  code: number,
): void {
  if (!target) {
    ctx.fn.unreachable(); // no crossing break/continue can reach here
    return;
  }
  if (frame.index > target.finallyDepth) {
    const outer = ctx.finallyStack[frame.index - 1]!; // an intervening finally still to run
    ctx.fn.store(imm(T.i32, code), outer.code);
    ctx.fn.br(outer.cleanupEntry);
  } else {
    ctx.fn.br(target.block);
  }
}

// Route a break/continue that may cross one or more `finally` blocks: if none intervene, jump
// straight to the target; otherwise mark the completion and enter the innermost finally's cleanup.
function emitAbruptJump(ctx: Ctx, target: LoopTarget, code: number): void {
  if (target.finallyDepth === ctx.finallyStack.length) {
    ctx.fn.br(target.block);
    return;
  }
  const frame = ctx.finallyStack[ctx.finallyStack.length - 1]!;
  ctx.fn.store(imm(T.i32, code), frame.code);
  ctx.fn.br(frame.cleanupEntry);
}

// Perform a RETURN completion at a cleanup dispatch: chain through an enclosing finally if one
// exists (so the outer finally also runs), otherwise do the real function return.
function emitReturnCompletion(ctx: Ctx, retSlot: Value | null): void {
  const outer = ctx.finallyStack[ctx.finallyStack.length - 1];
  if (outer) {
    ctx.fn.store(imm(T.i32, C_RETURN), outer.code);
    if (retSlot && outer.retVal) {
      ctx.fn.store(ctx.fn.load(irTypeOf(ctx.fnReturnType!), retSlot), outer.retVal);
    }
    ctx.fn.br(outer.cleanupEntry);
    return;
  }
  if (retSlot) {
    ctx.fn.ret(ctx.fn.load(irTypeOf(ctx.fnReturnType!), retSlot));
  } else if (ctx.fn.returnType.kind === "void") {
    ctx.fn.retVoid(); // a void function's `return;` inside a try
  } else {
    // No return value and a non-void frame (e.g. a top-level try in `main`, which has no `return`):
    // this dispatch arm is unreachable, but must not emit a type-mismatched `ret void`.
    ctx.fn.unreachable();
  }
}

// Print one value with no separator or newline. Optionals branch on the sentinel; other types
// evaluate and print directly.
function emitPrintValue(v: HExpr, ctx: Ctx): void {
  if (v.type.kind === "optional") {
    emitPrintOptional(v, ctx);
    return;
  }
  // Bare `undefined` / `null` literals print their word.
  if (v.type.kind === "undefined" || v.type.kind === "null") {
    ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring(v.type.kind)]);
    return;
  }
  emitPrintComputed(evalValue(v, ctx), v.type, ctx);
}

// Print an already-computed Value of a printable scalar type.
function emitPrintComputed(val: Value, type: ValueType, ctx: Ctx): void {
  switch (type.kind) {
    case "number":
      ctx.fn.callVoid("@cs_print_f64", [val]);
      return;
    case "string":
      ctx.fn.callVoid("@cs_print_cstr", [val]);
      return;
    case "boolean":
      ctx.fn.callVoid("@cs_print_bool", [ctx.fn.zextI1ToI32(val)]);
      return;
    case "array":
    case "object":
    case "map":
    case "set":
      // Containers print in util.inspect form; strings inside get quoted.
      ctx.fn.callVoid("@cs_print_cstr", [inspect(val, type, ctx)]);
      return;
    default:
      ice(`codegen: console.log of ${type.kind} not supported yet`);
  }
}

// console.log of an optional: "undefined" for the sentinel, else the unboxed inner value.
function emitPrintOptional(v: HExpr, ctx: Ctx): void {
  if (v.type.kind !== "optional") ice("emitPrintOptional: not optional");
  const inner = v.type.inner;
  const opt = evalOptionalPtr(v, ctx);
  const isUndef = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", opt, ctx.mod.externGlobal("cs_null_marker"));
  const undefB = ctx.fn.newBlock("print.undef");
  const notUndefB = ctx.fn.newBlock("print.notundef");
  const nullB = ctx.fn.newBlock("print.null");
  const valB = ctx.fn.newBlock("print.val");
  const endB = ctx.fn.newBlock("print.end");
  ctx.fn.brCond(isUndef, undefB, notUndefB);

  ctx.fn.switchTo(undefB);
  ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring("undefined")]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(isNull, nullB, valB);

  ctx.fn.switchTo(nullB);
  ctx.fn.callVoid("@cs_print_cstr", [ctx.mod.cstring("null")]);
  ctx.fn.br(endB);

  ctx.fn.switchTo(valB);
  emitPrintComputed(unboxOptionalValue(opt, inner, ctx), inner, ctx);
  ctx.fn.br(endB);

  ctx.fn.switchTo(endB);
}

// `switch` with JS fall-through: dispatch each case value against the discriminant (===), then
// lay bodies out so a non-terminating body falls into the next. `break` targets the end.
function emitSwitch(stmt: Extract<HStmt, { kind: "switch" }>, ctx: Ctx): void {
  const disc = evalValue(stmt.disc, ctx);
  const bodies = stmt.cases.map(() => ctx.fn.newBlock("case.body"));
  const endB = ctx.fn.newBlock("switch.end");
  const defaultIdx = stmt.cases.findIndex((c) => c.test === null);

  // Dispatch chain: test each non-default case in order; on match jump to its body.
  stmt.cases.forEach((c, i) => {
    if (c.test === null) return;
    const eq = emitStrictEq(disc, evalValue(c.test, ctx), stmt.discType, ctx);
    const next = ctx.fn.newBlock("case.test");
    ctx.fn.brCond(eq, bodies[i]!, next);
    ctx.fn.switchTo(next);
  });
  // No case matched → default (wherever it sits) or past the end.
  ctx.fn.br(defaultIdx >= 0 ? bodies[defaultIdx]! : endB);

  // Bodies, in order, with fall-through to the next body.
  ctx.breakTargets.push({ block: endB, finallyDepth: ctx.finallyStack.length });
  stmt.cases.forEach((c, i) => {
    ctx.fn.switchTo(bodies[i]!);
    emitStatements(c.body, ctx);
    if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(bodies[i + 1] ?? endB);
  });
  ctx.breakTargets.pop();

  ctx.fn.switchTo(endB);
}

function emitStatement(stmt: HStmt, ctx: Ctx): void {
  switch (stmt.kind) {
    case "consoleLog": {
      // Print each value; a space between adjacent values; a trailing newline (Node semantics).
      stmt.values.forEach((v, i) => {
        if (i > 0) ctx.fn.callVoid("@cs_print_space", []);
        emitPrintValue(v, ctx);
      });
      ctx.fn.callVoid("@cs_print_newline", []);
      return;
    }

    case "processExit":
      // JS exit code: evaluate the number, truncate to i32.
      ctx.fn.callVoid("@exit", [ctx.fn.fptosi_i32(evalNumber(stmt.code, ctx))]);
      return;

    case "return": {
      // Inside a try/catch/finally, a return routes to the innermost cleanup (so finally runs and
      // the handler depth is restored) carrying the return value; otherwise it returns directly.
      const frame = ctx.finallyStack[ctx.finallyStack.length - 1];
      if (frame) {
        ctx.fn.store(imm(T.i32, C_RETURN), frame.code);
        if (stmt.value && frame.retVal) ctx.fn.store(evalValue(stmt.value, ctx), frame.retVal);
        ctx.fn.br(frame.cleanupEntry);
        return;
      }
      if (stmt.value) ctx.fn.ret(evalValue(stmt.value, ctx));
      else ctx.fn.retVoid();
      return;
    }

    case "callStmt": {
      // Result discarded. A void callee uses callVoid; a value-returning callee is called and
      // its result ignored.
      const args = stmt.args.map((a) => evalValue(a, ctx));
      if (stmt.returnType === null) ctx.fn.callVoid(`@${stmt.name}`, args);
      else ctx.fn.call(`@${stmt.name}`, irTypeOf(stmt.returnType), args);
      return;
    }

    case "virtualCallStmt":
      evalVirtualCallStmt(stmt.receiver, stmt.vtableIndex, stmt.args, stmt.returnType, ctx);
      return;

    case "throwError": {
      // Build a CsThrown (Error vs thrown-string) and throw it. cs_throw does not return (it
      // longjmps or terminates), so the block ends unreachable.
      const msg = stmt.message ? evalValue(stmt.message, ctx) : ctx.fn.nullPtr();
      const thrown = ctx.fn.call(stmt.isError ? "@cs_new_error" : "@cs_new_thrown_str", T.ptr, [
        msg,
      ]);
      ctx.fn.callVoid("@cs_throw", [thrown]);
      ctx.fn.unreachable();
      return;
    }

    case "rethrowValue": {
      // `throw e` — re-raise a caught CsThrown value unchanged.
      ctx.fn.callVoid("@cs_throw", [evalValue(stmt.value, ctx)]);
      ctx.fn.unreachable();
      return;
    }

    case "tryCatch":
      emitTryCatch(stmt, ctx);
      return;

    case "exprStmt":
      // Evaluate for side effects; discard the value (e.g. `arr.push(x);`).
      evalValue(stmt.expr, ctx);
      return;

    case "varDecl": {
      // Allocate a slot, evaluate the initializer, store it, and bind the name.
      const ptr = ctx.fn.alloca(irTypeOf(stmt.type));
      ctx.fn.store(evalValue(stmt.init, ctx), ptr);
      ctx.vars.set(stmt.name, { ptr, vtype: stmt.type });
      return;
    }

    case "assign": {
      // Store into the existing slot. Evaluate the value BEFORE looking up the slot so a
      // self-referential `n = n + 1` loads the old value first.
      const value = evalValue(stmt.value, ctx);
      ctx.fn.store(value, lookupVar(stmt.name, ctx).ptr);
      return;
    }

    case "memberSet": {
      // Evaluate the object record, box the new value, store it into the field's slot (offset by
      // the vtable header for class instances).
      const obj = evalObjectPtr(stmt.object, ctx);
      const slot = boxSlot(evalValue(stmt.value, ctx), stmt.value.type, ctx);
      ctx.fn.store(slot, ctx.fn.gepSlot(obj, stmt.slot + headerOffset(stmt.object.type)));
      return;
    }

    case "if": {
      const cond = toBool(stmt.cond, ctx);
      const thenB = ctx.fn.newBlock("if.then");
      const elseB = stmt.otherwise ? ctx.fn.newBlock("if.else") : null;
      const endB = ctx.fn.newBlock("if.end");

      ctx.fn.brCond(cond, thenB, elseB ?? endB);

      ctx.fn.switchTo(thenB);
      emitStatements(stmt.then, ctx);
      // A branch body may already have terminated (a return/break/continue); only jump to the
      // merge block if control can still fall through.
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(endB);

      if (elseB) {
        ctx.fn.switchTo(elseB);
        emitStatements(stmt.otherwise!, ctx);
        if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(endB);
      }

      ctx.fn.switchTo(endB);
      return;
    }

    case "while": {
      const headerB = ctx.fn.newBlock("while.header");
      const bodyB = ctx.fn.newBlock("while.body");
      const endB = ctx.fn.newBlock("while.end");

      ctx.fn.br(headerB); // enter the loop
      ctx.fn.switchTo(headerB);
      ctx.fn.brCond(toBool(stmt.cond, ctx), bodyB, endB);

      ctx.fn.switchTo(bodyB);
      // break → end, continue → header (re-check condition).
      ctx.breakTargets.push({ block: endB, finallyDepth: ctx.finallyStack.length });
      ctx.continueTargets.push({ block: headerB, finallyDepth: ctx.finallyStack.length });
      emitStatements(stmt.body, ctx);
      ctx.breakTargets.pop();
      ctx.continueTargets.pop();
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(headerB);

      ctx.fn.switchTo(endB);
      return;
    }

    case "for": {
      emitStatements(stmt.init, ctx);
      const headerB = ctx.fn.newBlock("for.header");
      const bodyB = ctx.fn.newBlock("for.body");
      const latchB = ctx.fn.newBlock("for.latch"); // runs the update, then re-checks
      const endB = ctx.fn.newBlock("for.end");

      ctx.fn.br(headerB);
      ctx.fn.switchTo(headerB);
      // A missing condition is an always-true loop.
      if (stmt.cond) ctx.fn.brCond(toBool(stmt.cond, ctx), bodyB, endB);
      else ctx.fn.br(bodyB);

      ctx.fn.switchTo(bodyB);
      // break → end, continue → latch (so the update still runs before re-checking).
      ctx.breakTargets.push({ block: endB, finallyDepth: ctx.finallyStack.length });
      ctx.continueTargets.push({ block: latchB, finallyDepth: ctx.finallyStack.length });
      emitStatements(stmt.body, ctx);
      ctx.breakTargets.pop();
      ctx.continueTargets.pop();
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(latchB);

      ctx.fn.switchTo(latchB);
      emitStatements(stmt.update, ctx);
      ctx.fn.br(headerB);

      ctx.fn.switchTo(endB);
      return;
    }

    case "forOf": {
      // Iterate 0..len-1, re-reading the (once-evaluated) array's length each step. Binds the
      // loop variable to each element. break → end, continue → the index bump (latch).
      const arrPtr = ctx.fn.alloca(T.ptr);
      ctx.fn.store(evalArrayPtr(stmt.array, ctx), arrPtr);
      const idxPtr = ctx.fn.alloca(T.i32);
      ctx.fn.store(imm(T.i32, 0), idxPtr);
      const elemPtr = ctx.fn.alloca(irTypeOf(stmt.elementType));
      ctx.vars.set(stmt.name, { ptr: elemPtr, vtype: stmt.elementType });

      const headerB = ctx.fn.newBlock("forof.header");
      const bodyB = ctx.fn.newBlock("forof.body");
      const latchB = ctx.fn.newBlock("forof.latch");
      const endB = ctx.fn.newBlock("forof.end");

      ctx.fn.br(headerB);
      ctx.fn.switchTo(headerB);
      const i = ctx.fn.load(T.i32, idxPtr);
      const len = ctx.fn.call("@cs_array_len", T.i32, [ctx.fn.load(T.ptr, arrPtr)]);
      ctx.fn.brCond(ctx.fn.icmp("slt", i, len), bodyB, endB);

      ctx.fn.switchTo(bodyB);
      const elem = arrayElementAt(
        ctx.fn.load(T.ptr, arrPtr),
        ctx.fn.load(T.i32, idxPtr),
        stmt.elementType,
        ctx,
      );
      ctx.fn.store(elem, elemPtr);
      ctx.breakTargets.push({ block: endB, finallyDepth: ctx.finallyStack.length });
      ctx.continueTargets.push({ block: latchB, finallyDepth: ctx.finallyStack.length });
      emitStatements(stmt.body, ctx);
      ctx.breakTargets.pop();
      ctx.continueTargets.pop();
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(latchB);

      ctx.fn.switchTo(latchB);
      ctx.fn.store(ctx.fn.iadd(ctx.fn.load(T.i32, idxPtr), imm(T.i32, 1)), idxPtr);
      ctx.fn.br(headerB);

      ctx.fn.switchTo(endB);
      return;
    }

    case "break": {
      const target = ctx.breakTargets[ctx.breakTargets.length - 1];
      if (!target) ice("codegen: break outside a loop or switch");
      emitAbruptJump(ctx, target, C_BREAK);
      return;
    }

    case "continue": {
      const target = ctx.continueTargets[ctx.continueTargets.length - 1];
      if (!target) ice("codegen: continue outside a loop");
      emitAbruptJump(ctx, target, C_CONTINUE);
      return;
    }

    case "switch":
      emitSwitch(stmt, ctx);
      return;

    default:
      ice(`codegen: unhandled statement ${(stmt as { kind: string }).kind}`);
  }
}
