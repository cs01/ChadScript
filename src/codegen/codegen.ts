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
import {
  evalNumber,
  evalBool,
  evalString,
  evalValue,
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
  mod.declareExtern("exit", T.void, [T.i32]);

  // User functions first (order doesn't matter — LLVM resolves calls by name, so recursion and
  // mutual recursion just work).
  for (const f of hmod.functions) emitFunction(f, mod);

  // The synthesized entry function holds the top-level statements.
  const main = mod.defineFunc("main", T.i32, []);
  const ctx: Ctx = { mod, fn: main, vars: new Map() };
  for (const stmt of hmod.topLevel) emitStatement(stmt, ctx);
  main.ret(imm(T.i32, 0));
  return mod.render();
}

function emitFunction(f: HFunc, mod: ModuleBuilder): void {
  const retType = f.returnType ? irTypeOf(f.returnType) : T.void;
  const irParams: Value[] = f.params.map((p, i) => ({ name: `%arg${i}`, type: irTypeOf(p.type) }));
  const fn = mod.defineFunc(f.name, retType, irParams);
  const ctx: Ctx = { mod, fn, vars: new Map() };

  // Copy each parameter into a stack slot so it can be reassigned like any local (JS allows
  // reassigning parameters), and bind the name to that slot.
  f.params.forEach((p, i) => {
    const ptr = fn.alloca(irTypeOf(p.type));
    fn.store(irParams[i]!, ptr);
    ctx.vars.set(p.name, { ptr, vtype: p.type });
  });

  for (const stmt of f.body) emitStatement(stmt, ctx);

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

    case "if": {
      const cond = toBool(stmt.cond, ctx);
      const thenB = ctx.fn.newBlock("if.then");
      const elseB = stmt.otherwise ? ctx.fn.newBlock("if.else") : null;
      const endB = ctx.fn.newBlock("if.end");

      ctx.fn.brCond(cond, thenB, elseB ?? endB);

      ctx.fn.switchTo(thenB);
      for (const s of stmt.then) emitStatement(s, ctx);
      // A branch body may already have terminated (e.g. a nested return once we have it); only
      // add the jump to the merge block if control can still fall through.
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(endB);

      if (elseB) {
        ctx.fn.switchTo(elseB);
        for (const s of stmt.otherwise!) emitStatement(s, ctx);
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
      for (const s of stmt.body) emitStatement(s, ctx);
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(headerB); // loop back to re-check cond

      ctx.fn.switchTo(endB);
      return;
    }

    case "for": {
      for (const s of stmt.init) emitStatement(s, ctx);
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
      for (const s of stmt.body) emitStatement(s, ctx);
      if (!ctx.fn.currentBlock.isTerminated) ctx.fn.br(latchB);

      ctx.fn.switchTo(latchB);
      for (const s of stmt.update) emitStatement(s, ctx);
      ctx.fn.br(headerB);

      ctx.fn.switchTo(endB);
      return;
    }

    default:
      ice(`codegen: unhandled statement ${(stmt as { kind: string }).kind}`);
  }
}
