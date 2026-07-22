// Phase 0 codegen: lower a validated program to LLVM IR. The surface is deliberately tiny —
// `console.log("<literal>")` and `process.exit(<int literal>)` — enough to prove the whole
// pipeline (frontend → validate → codegen → clang → binary) end to end against Node.
//
// This file is a SCAFFOLD. Real expression/statement lowering arrives in Phase 1 over the
// HIR; do not grow this into the codegen. Anything the validator admitted but this scaffold
// does not recognize is an ICE (loud), never silent output.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { ModuleBuilder, imm, type FuncBuilder } from "../ir/builder.js";
import { T } from "../ir/types.js";

export function generate(loaded: LoadedProgram): string {
  const mod = new ModuleBuilder();
  mod.declareExtern("cs_console_log_cstr", T.void, [T.ptr]);
  mod.declareExtern("exit", T.void, [T.i32]);

  const main = mod.defineFunc("main", T.i32, []);
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) emitStatement(stmt, main, mod);
  }
  main.ret(imm(T.i32, 0));
  return mod.render();
}

function emitStatement(stmt: ts.Statement, fn: FuncBuilder, mod: ModuleBuilder): void {
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    emitCall(stmt.expression, fn, mod);
    return;
  }
  ice(`phase0 codegen: unsupported statement ${ts.SyntaxKind[stmt.kind]}`);
}

function emitCall(call: ts.CallExpression, fn: FuncBuilder, mod: ModuleBuilder): void {
  const target = calleeName(call.expression);

  if (target === "console.log") {
    const arg = call.arguments[0];
    if (call.arguments.length === 1 && arg && ts.isStringLiteral(arg)) {
      fn.callVoid("@cs_console_log_cstr", [mod.cstring(arg.text)]);
      return;
    }
    ice("phase0 codegen: console.log supports exactly one string-literal argument");
  }

  if (target === "process.exit") {
    const arg = call.arguments[0];
    if (call.arguments.length === 1 && arg && ts.isNumericLiteral(arg)) {
      fn.callVoid("@exit", [imm(T.i32, parseInt(arg.text, 10))]);
      return;
    }
    ice("phase0 codegen: process.exit supports exactly one int-literal argument");
  }

  ice(`phase0 codegen: unsupported call ${target}`);
}

// "console.log" / "process.exit" for a property-access callee; bare name otherwise.
function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
