// Backend: HIR → LLVM IR. Consumes HModule only. This module (and everything under codegen/)
// MUST NOT import `typescript` or touch the checker — the type wall is enforced by
// tests/unit/architecture.test.ts. All type decisions were made in lower/ and are recorded on
// the HIR nodes; here we only translate. An unhandled shape is an ICE (loud), never silent IR.
//
// TO EXTEND: add a case here for a new HIR node, add the node in hir/, and lower it in lower/.
// Never reach back to the AST or checker from this file.

import { ice } from "../diagnostics.js";
import { ModuleBuilder, imm } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HModule, HStmt } from "../hir/nodes.js";
import { evalNumber, evalBool, type Ctx } from "./expr.js";

export function generate(hmod: HModule): string {
  const mod = new ModuleBuilder();
  mod.declareExtern("cs_console_log_cstr", T.void, [T.ptr]);
  mod.declareExtern("cs_console_log_f64", T.void, [T.double]);
  mod.declareExtern("cs_console_log_bool", T.void, [T.i32]);
  mod.declareExtern("exit", T.void, [T.i32]);

  const fn = mod.defineFunc("main", T.i32, []);
  const ctx: Ctx = { mod, fn };
  for (const stmt of hmod.statements) emitStatement(stmt, ctx);
  fn.ret(imm(T.i32, 0));
  return mod.render();
}

function emitStatement(stmt: HStmt, ctx: Ctx): void {
  switch (stmt.kind) {
    case "consoleLog": {
      const v = stmt.value;
      switch (v.type.kind) {
        case "number":
          ctx.fn.callVoid("@cs_console_log_f64", [evalNumber(v, ctx)]);
          return;
        case "string":
          if (v.kind === "stringLit") {
            ctx.fn.callVoid("@cs_console_log_cstr", [ctx.mod.cstring(v.value)]);
            return;
          }
          ice("codegen: console.log(string) supports a string literal only (Phase 1)");
          return;
        case "boolean":
          // Runtime takes the boolean as i32 (0/1).
          ctx.fn.callVoid("@cs_console_log_bool", [ctx.fn.zextI1ToI32(evalBool(v, ctx))]);
          return;
        default:
          ice(`codegen: console.log of ${v.type.kind} not supported yet`);
          return;
      }
    }

    case "processExit":
      // JS exit code: evaluate the number, truncate to i32.
      ctx.fn.callVoid("@exit", [ctx.fn.fptosi_i32(evalNumber(stmt.code, ctx))]);
      return;

    default:
      ice(`codegen: unhandled statement ${(stmt as { kind: string }).kind}`);
  }
}
