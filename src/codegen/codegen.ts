// Phase 0/1 codegen: lower a validated program to LLVM IR. Surface so far:
//   console.log("<string literal>")   → cs_console_log_cstr
//   console.log(<number literal>)     → cs_console_log_f64   (dispatched by the checker's type)
//   process.exit(<int literal>)       → exit
//
// This file is a SCAFFOLD to be replaced by real HIR-based lowering. Anything the validator
// admitted but this scaffold does not recognize is an ICE (loud), never silent output. The
// string-vs-number choice for console.log comes from the type checker — tsc is the oracle.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { ModuleBuilder, imm, fimm, type FuncBuilder } from "../ir/builder.js";
import { T } from "../ir/types.js";

interface Ctx {
  mod: ModuleBuilder;
  fn: FuncBuilder;
  checker: ts.TypeChecker;
}

export function generate(loaded: LoadedProgram): string {
  const mod = new ModuleBuilder();
  mod.declareExtern("cs_console_log_cstr", T.void, [T.ptr]);
  mod.declareExtern("cs_console_log_f64", T.void, [T.double]);
  mod.declareExtern("exit", T.void, [T.i32]);

  const fn = mod.defineFunc("main", T.i32, []);
  const ctx: Ctx = { mod, fn, checker: loaded.checker };
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) emitStatement(stmt, ctx);
  }
  fn.ret(imm(T.i32, 0));
  return mod.render();
}

function emitStatement(stmt: ts.Statement, ctx: Ctx): void {
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    emitCall(stmt.expression, ctx);
    return;
  }
  ice(`codegen: unsupported statement ${ts.SyntaxKind[stmt.kind]}`);
}

function emitCall(call: ts.CallExpression, ctx: Ctx): void {
  const target = calleeName(call.expression);

  if (target === "console.log") {
    const arg = call.arguments[0];
    if (call.arguments.length !== 1 || !arg) {
      ice("codegen: console.log supports exactly one argument");
    }
    emitConsoleLog(arg, ctx);
    return;
  }

  if (target === "process.exit") {
    const arg = call.arguments[0];
    if (call.arguments.length === 1 && arg && ts.isNumericLiteral(arg)) {
      ctx.fn.callVoid("@exit", [imm(T.i32, parseInt(arg.text, 10))]);
      return;
    }
    ice("codegen: process.exit supports exactly one int-literal argument");
  }

  ice(`codegen: unsupported call ${target}`);
}

function emitConsoleLog(arg: ts.Expression, ctx: Ctx): void {
  const flags = ctx.checker.getTypeAtLocation(arg).flags;
  // The checker's type decides the runtime path — string vs number.
  if (flags & (ts.TypeFlags.StringLike | ts.TypeFlags.String)) {
    if (ts.isStringLiteral(arg)) {
      ctx.fn.callVoid("@cs_console_log_cstr", [ctx.mod.cstring(arg.text)]);
      return;
    }
    ice("codegen: console.log(string) supports a string literal only (Phase 1 commit 1)");
  }
  if (flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.Number)) {
    if (ts.isNumericLiteral(arg)) {
      ctx.fn.callVoid("@cs_console_log_f64", [fimm(Number(arg.text))]);
      return;
    }
    ice("codegen: console.log(number) supports a numeric literal only (Phase 1 commit 1)");
  }
  ice(`codegen: console.log argument type not supported yet (flags ${flags})`);
}

// "console.log" / "process.exit" for a property-access callee; bare name otherwise.
function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
