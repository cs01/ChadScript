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
  evalObjectPtr,
  arrayElementAt,
  boxSlot,
  irTypeOf,
  lookupVar,
  toBool,
  type Ctx,
} from "./expr.js";

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
  mod.declareExtern("cs_bool_to_string", T.ptr, [T.i32]);
  mod.declareExtern("cs_str_eq", T.i32, [T.ptr, T.ptr]);
  // Math.* : libm (double→double) + JS-semantics helpers.
  for (const f of ["floor", "ceil", "trunc", "sqrt", "fabs", "cs_math_round", "cs_math_sign"]) {
    mod.declareExtern(f, T.double, [T.double]);
  }
  mod.declareExtern("pow", T.double, [T.double, T.double]);
  // String methods.
  mod.declareExtern("cs_str_len", T.i32, [T.ptr]);
  for (const f of ["cs_str_upper", "cs_str_lower", "cs_str_trim"]) {
    mod.declareExtern(f, T.ptr, [T.ptr]);
  }
  mod.declareExtern("cs_str_repeat", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_index_of", T.double, [T.ptr, T.ptr]);
  for (const f of ["cs_str_includes", "cs_str_starts_with", "cs_str_ends_with"]) {
    mod.declareExtern(f, T.i32, [T.ptr, T.ptr]);
  }
  mod.declareExtern("cs_gc_init", T.void, []);
  mod.declareExtern("cs_gc_alloc", T.ptr, [T.i64]);
  mod.declareExtern("cs_array_new", T.ptr, []);
  mod.declareExtern("cs_array_push", T.i32, [T.ptr, T.i64]);
  mod.declareExtern("cs_array_len", T.i32, [T.ptr]);
  mod.declareExtern("cs_array_get", T.i64, [T.ptr, T.i32]);
  mod.declareExtern("exit", T.void, [T.i32]);

  // User functions first (order doesn't matter — LLVM resolves calls by name, so recursion and
  // mutual recursion just work).
  for (const f of hmod.functions) emitFunction(f, mod);

  // The synthesized entry function holds the top-level statements.
  const main = mod.defineFunc("main", T.i32, []);
  const ctx: Ctx = { mod, fn: main, vars: new Map(), breakTargets: [], continueTargets: [] };
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
  const irParams: Value[] = f.params.map((p, i) => ({ name: `%arg${i}`, type: irTypeOf(p.type) }));
  const fn = mod.defineFunc(f.name, retType, irParams);
  const ctx: Ctx = { mod, fn, vars: new Map(), breakTargets: [], continueTargets: [] };

  // Copy each parameter into a stack slot so it can be reassigned like any local (JS allows
  // reassigning parameters), and bind the name to that slot.
  f.params.forEach((p, i) => {
    const ptr = fn.alloca(irTypeOf(p.type));
    fn.store(irParams[i]!, ptr);
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

// Print one value with no separator or newline, dispatched on its resolved type.
function emitPrintValue(v: HExpr, ctx: Ctx): void {
  switch (v.type.kind) {
    case "number":
      ctx.fn.callVoid("@cs_print_f64", [evalNumber(v, ctx)]);
      return;
    case "string":
      ctx.fn.callVoid("@cs_print_cstr", [evalString(v, ctx)]);
      return;
    case "boolean":
      ctx.fn.callVoid("@cs_print_bool", [ctx.fn.zextI1ToI32(evalBool(v, ctx))]);
      return;
    default:
      ice(`codegen: console.log of ${v.type.kind} not supported yet`);
  }
}

// Strict-equality (`===`) of two already-computed Values, dispatched on their shared type.
// Matches JS: numbers via ordered fcmp oeq (NaN===NaN false), booleans via icmp, strings via
// the runtime string compare.
function emitStrictEq(a: Value, b: Value, type: ValueType, ctx: Ctx): Value {
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
  ctx.breakTargets.push(endB);
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

    case "return":
      if (stmt.value) ctx.fn.ret(evalValue(stmt.value, ctx));
      else ctx.fn.retVoid();
      return;

    case "callStmt": {
      // Result discarded. A void callee uses callVoid; a value-returning callee is called and
      // its result ignored.
      const args = stmt.args.map((a) => evalValue(a, ctx));
      if (stmt.returnType === null) ctx.fn.callVoid(`@${stmt.name}`, args);
      else ctx.fn.call(`@${stmt.name}`, irTypeOf(stmt.returnType), args);
      return;
    }

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
      // Evaluate the object record, box the new value, store it into the field's slot.
      const obj = evalObjectPtr(stmt.object, ctx);
      const slot = boxSlot(evalValue(stmt.value, ctx), stmt.value.type, ctx);
      ctx.fn.store(slot, ctx.fn.gepSlot(obj, stmt.slot));
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
      ctx.breakTargets.push(endB);
      ctx.continueTargets.push(headerB);
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
      ctx.breakTargets.push(endB);
      ctx.continueTargets.push(latchB);
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
      ctx.breakTargets.push(endB);
      ctx.continueTargets.push(latchB);
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
      ctx.fn.br(target);
      return;
    }

    case "continue": {
      const target = ctx.continueTargets[ctx.continueTargets.length - 1];
      if (!target) ice("codegen: continue outside a loop");
      ctx.fn.br(target);
      return;
    }

    case "switch":
      emitSwitch(stmt, ctx);
      return;

    default:
      ice(`codegen: unhandled statement ${(stmt as { kind: string }).kind}`);
  }
}
